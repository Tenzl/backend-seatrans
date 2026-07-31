import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';
import type { SessionJwtClaims } from '../session-policy';
import type { Request } from 'express';
import type { User } from '../entities/user.entity';

type AuthedRequest = Request & { sessionJwt?: SessionJwtClaims };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cookieJwtExtractor(request: unknown): string | null {
  if (!isRecord(request) || !isRecord(request.cookies)) return null;
  const token = request.cookies.auth_token;
  return typeof token === 'string' && token.trim() ? token : null;
}

function toSessionClaims(payload: Record<string, unknown>): SessionJwtClaims {
  const sub = Number(payload.sub);
  const authTimeRaw = payload.auth_time ?? payload.iat;
  const auth_time = Number(authTimeRaw);
  const roles = Array.isArray(payload.roles)
    ? payload.roles.filter((r): r is string => typeof r === 'string')
    : [];

  return {
    sub,
    email: typeof payload.email === 'string' ? payload.email : '',
    roleGroup: typeof payload.roleGroup === 'string' ? payload.roleGroup : null,
    roles,
    auth_time: Number.isFinite(auth_time) ? auth_time : 0,
    remember: payload.remember === true,
    iat: typeof payload.iat === 'number' ? payload.iat : undefined,
    exp: typeof payload.exp === 'number' ? payload.exp : undefined,
  };
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieJwtExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('APP_JWT_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(
    req: AuthedRequest,
    payload: Record<string, unknown>,
  ): Promise<User> {
    const claims = toSessionClaims(payload);
    if (!Number.isInteger(claims.sub) || claims.sub <= 0) {
      throw new UnauthorizedException('Invalid token subject');
    }
    if (!claims.auth_time || claims.auth_time <= 0) {
      throw new UnauthorizedException('Invalid session (missing auth_time)');
    }

    const user = await this.authService.validateUserContext(claims.sub);
    if (!user) {
      throw new UnauthorizedException('User not found or disabled');
    }

    // Absolute ceiling from original login — activity cannot extend this.
    if (this.authService.isAbsoluteSessionExpired(claims, user)) {
      throw new UnauthorizedException('Session expired — please sign in again');
    }

    req.sessionJwt = claims;
    return user;
  }
}
