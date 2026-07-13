import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

type JwtAccessPayload = { sub?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cookieJwtExtractor(request: unknown): string | null {
  if (!isRecord(request) || !isRecord(request.cookies)) return null;
  const token = request.cookies.auth_token;
  return typeof token === 'string' && token.trim() ? token : null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieJwtExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('APP_JWT_SECRET'),
    });
  }

  async validate(payload: JwtAccessPayload) {
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new UnauthorizedException('Invalid token subject');
    }
    const user = await this.authService.validateUserContext(userId);
    if (!user) {
      throw new UnauthorizedException('User not found or disabled');
    }
    return user;
  }
}
