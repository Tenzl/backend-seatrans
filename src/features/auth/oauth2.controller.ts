import {
  BadRequestException,
  Controller,
  Get,
  HttpStatus,
  Logger,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { resolveGoogleFullName } from './dto/oauth-profile.dto';
import { setAuthCookie } from './auth-cookie';
import {
  consumeOAuthState,
  generateOAuthState,
  setOAuthStateCookie,
} from './oauth-state';
import { safeErrorForLog } from '../../shared/logging/safe-error-log';
import { abortSignalAfter } from '../../shared/utils/with-timeout';
import { readPositiveInt } from '../../shared/utils/env-int';

const DEFAULT_GOOGLE_OAUTH_TIMEOUT_MS = 15_000;

@Controller('v1/auth/oauth2')
export class OAuth2Controller {
  private readonly logger = new Logger(OAuth2Controller.name);
  private readonly googleTimeoutMs: number;

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    this.googleTimeoutMs = readPositiveInt(
      this.configService.get<string>('GOOGLE_OAUTH_TIMEOUT_MS'),
      DEFAULT_GOOGLE_OAUTH_TIMEOUT_MS,
      { min: 1_000, max: 60_000 },
    );
  }

  @Get('google')
  initiateGoogleLogin(@Res({ passthrough: true }) res: Response) {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID')?.trim();
    const redirectUri = this.configService
      .get<string>('GOOGLE_REDIRECT_URI')
      ?.trim();

    if (!clientId || !redirectUri) {
      throw new BadRequestException('Google OAuth is not configured');
    }

    const state = generateOAuthState();
    setOAuthStateCookie(res, state);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'profile email',
      state,
    });

    return {
      authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    };
  }

  @Get('callback/google')
  async handleGoogleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const hasValidState = consumeOAuthState(req, res, state);
    try {
      if (!hasValidState) {
        throw new Error('Invalid OAuth state');
      }
      if (!code?.trim()) {
        throw new Error('Missing authorization code');
      }

      const clientId = this.configService
        .get<string>('GOOGLE_CLIENT_ID')
        ?.trim();
      const clientSecret = this.configService
        .get<string>('GOOGLE_CLIENT_SECRET')
        ?.trim();
      const redirectUri = this.configService
        .get<string>('GOOGLE_REDIRECT_URI')
        ?.trim();

      if (!clientId || !clientSecret || !redirectUri) {
        throw new Error('Google OAuth is not configured');
      }

      const tokenBody = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
        signal: abortSignalAfter(this.googleTimeoutMs),
      });

      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        error_description?: string;
      };

      if (!tokenRes.ok || !tokenJson.access_token) {
        throw new Error(tokenJson.error_description || 'Token exchange failed');
      }

      const userInfoRes = await fetch(
        'https://www.googleapis.com/oauth2/v3/userinfo',
        {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
          signal: abortSignalAfter(this.googleTimeoutMs),
        },
      );

      const userInfo = (await userInfoRes.json()) as {
        email?: string;
        name?: string;
        given_name?: string;
        family_name?: string;
        sub?: string;
        email_verified?: boolean;
      };

      if (!userInfoRes.ok || !userInfo.email || !userInfo.sub) {
        throw new Error('Failed to fetch Google user profile');
      }
      if (userInfo.email_verified !== true) {
        throw new Error('Google account email is not verified');
      }

      const user = await this.authService.findOrCreateOAuthUser({
        email: userInfo.email,
        fullName: resolveGoogleFullName(userInfo) || userInfo.email,
        provider: 'google',
        providerId: userInfo.sub,
        emailVerified: true,
      });

      if (!user.isActive) {
        return this.redirectToFrontend(res, '/login', 'account_disabled');
      }

      const auth = this.authService.buildAuthResponse(user);
      setAuthCookie(res, auth.token, auth.cookieMaxAgeMs);
      // Cookie is already set; land on home — AuthProvider hydrates via GET /auth/me.
      return this.redirectToFrontend(res, '/');
    } catch (error) {
      const safeError = safeErrorForLog(error);
      this.logger.error(
        `OAuth2 callback error: ${safeError.message}`,
        safeError.stack,
      );
      return this.redirectToFrontend(res, '/login', 'oauth_failed');
    }
  }

  private redirectToFrontend(
    res: Response,
    path: '/' | '/login',
    errorCode?: 'account_disabled' | 'oauth_failed',
  ) {
    const target = new URL(path, `${this.resolveFrontendOrigin()}/`);
    if (errorCode) target.searchParams.set('error', errorCode);
    return res.redirect(HttpStatus.SEE_OTHER, target.toString());
  }

  private resolveFrontendOrigin(): string {
    const origins = (
      this.configService.get<string>('CORS_ORIGINS') ?? 'http://localhost:3000'
    )
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    for (const candidate of origins) {
      try {
        const url = new URL(candidate);
        if (
          (url.protocol === 'http:' || url.protocol === 'https:') &&
          !url.username &&
          !url.password
        ) {
          return url.origin;
        }
      } catch {
        // Ignore malformed CORS entries and continue to the safe fixed fallback.
      }
    }

    return 'http://localhost:3000';
  }
}
