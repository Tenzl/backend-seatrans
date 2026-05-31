import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { resolveGoogleFullName } from './dto/oauth-profile.dto';

@Controller('v1/auth/oauth2')
export class OAuth2Controller {
  private readonly logger = new Logger(OAuth2Controller.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Get('google')
  initiateGoogleLogin() {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID')?.trim();
    const redirectUri = this.configService.get<string>('GOOGLE_REDIRECT_URI')?.trim();

    if (!clientId || !redirectUri) {
      throw new BadRequestException('Google OAuth is not configured');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'profile email',
    });

    return {
      authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    };
  }

  @Get('callback/google')
  async handleGoogleCallback(
    @Query('code') code: string | undefined,
    @Res() res: Response,
  ) {
    const frontendBase = this.resolveFrontendBase();

    try {
      if (!code?.trim()) {
        throw new Error('Missing authorization code');
      }

      const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID')?.trim();
      const clientSecret = this.configService.get<string>('GOOGLE_CLIENT_SECRET')?.trim();
      const redirectUri = this.configService.get<string>('GOOGLE_REDIRECT_URI')?.trim();

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
      });

      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        error_description?: string;
      };

      if (!tokenRes.ok || !tokenJson.access_token) {
        throw new Error(tokenJson.error_description || 'Token exchange failed');
      }

      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });

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

      const user = await this.authService.findOrCreateOAuthUser({
        email: userInfo.email,
        fullName: resolveGoogleFullName(userInfo) || userInfo.email,
        provider: 'google',
        providerId: userInfo.sub,
        emailVerified: userInfo.email_verified ?? true,
      });

      if (!user.isActive) {
        return res.redirect(`${frontendBase}/login?error=account_disabled`);
      }

      const auth = this.authService.buildAuthResponse(user);
      const callbackUrl = `${frontendBase}/auth/callback?token=${encodeURIComponent(auth.token)}`;
      return res.redirect(callbackUrl);
    } catch (error) {
      this.logger.error('OAuth2 callback error', error);
      return res.redirect(`${frontendBase}/login?error=oauth_failed`);
    }
  }

  private resolveFrontendBase(): string {
    const origins = (this.configService.get<string>('CORS_ORIGINS') ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    const frontendBase = origins[0] ?? 'http://localhost:3000';
    return frontendBase.replace(/\/+$/, '');
  }
}
