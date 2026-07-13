import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { OAuth2Controller } from './oauth2.controller';
import { AuthService } from './auth.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './strategies/jwt.strategy';

type JwtExpiration = NonNullable<
  NonNullable<JwtModuleOptions['signOptions']>['expiresIn']
>;

function parseJwtExpiration(value: string): JwtExpiration {
  if (/^\d+$/.test(value)) return Number(value);
  if (
    /^\d+(?:\.\d+)?\s*(?:years?|yrs?|y|weeks?|w|days?|d|hours?|hrs?|hr|h|minutes?|mins?|min|m|seconds?|secs?|sec|s|milliseconds?|msecs?|msec|ms)$/i.test(
      value,
    )
  ) {
    return value as JwtExpiration;
  }
  return '1d';
}

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('APP_JWT_SECRET'),
        signOptions: {
          expiresIn: parseJwtExpiration(
            configService.get<string>('APP_JWT_EXPIRATION', '1d'),
          ),
        },
      }),
    }),
  ],
  controllers: [AuthController, OAuth2Controller],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtStrategy, PassportModule],
})
export class AuthModule {}
