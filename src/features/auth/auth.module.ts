import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { OAuth2Controller } from './oauth2.controller';
import { AuthService } from './auth.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SessionSlidingInterceptor } from './session-sliding.interceptor';
import { LoginThrottleService } from './login-throttle.service';
import { loadSessionPolicyFromEnv, toJwtExpiresIn } from './session-policy';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const policy = loadSessionPolicyFromEnv({
          get: (key, defaultValue) =>
            defaultValue === undefined
              ? configService.get<string>(key)
              : configService.get<string>(key, defaultValue),
        });
        return {
          secret: configService.getOrThrow<string>('APP_JWT_SECRET'),
          // Default idle TTL; AuthService always passes an explicit expiresIn
          // capped by remaining absolute time.
          signOptions: {
            expiresIn: toJwtExpiresIn(policy.idleSeconds),
          },
        };
      },
    }),
  ],
  controllers: [AuthController, OAuth2Controller],
  providers: [
    AuthService,
    JwtStrategy,
    LoginThrottleService,
    { provide: APP_INTERCEPTOR, useClass: SessionSlidingInterceptor },
  ],
  exports: [AuthService, JwtStrategy, PassportModule],
})
export class AuthModule {}
