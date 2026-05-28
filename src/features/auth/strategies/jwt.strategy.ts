import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

function cookieJwtExtractor(req: any): string | null {
  const token = req?.cookies?.auth_token;
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

  async validate(payload: any) {
    const user = await this.authService.validateUserContext(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found or disabled');
    }
    return user;
  }
}
