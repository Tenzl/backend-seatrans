import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RoleGroup } from './enums/role-group.enum';
import type { User } from './entities/user.entity';
import type { SessionJwtClaims } from './session-policy';

describe('AuthService session sliding', () => {
  const sign = jest.fn((payload: SessionJwtClaims) => {
    void payload;
    return 'new-token';
  });
  const jwtService = {
    sign,
  };
  const configService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const map: Record<string, string> = {
        APP_JWT_IDLE: '1h',
        APP_JWT_SLIDE_BEFORE: '15m',
        APP_JWT_ABSOLUTE: '12h',
        APP_JWT_ABSOLUTE_REMEMBER: '7d',
      };
      return map[key] ?? defaultValue;
    }),
    getOrThrow: jest.fn(),
  };

  const service = new AuthService(
    {} as never,
    {} as never,
    jwtService as unknown as JwtService,
    configService as unknown as ConfigService,
    {
      invalidateUser: jest.fn(),
    } as never,
  );

  const user = {
    id: 1,
    email: 'a@b.c',
    sessionVersion: 1,
    role: { name: 'ROLE_CUSTOMER', roleGroup: RoleGroup.EXTERNAL },
  } as User;

  const now = Math.floor(Date.now() / 1000);

  it('slides when exp is within the slide-before window', () => {
    const claims: SessionJwtClaims = {
      sub: 1,
      email: 'a@b.c',
      roleGroup: RoleGroup.EXTERNAL,
      roles: ['ROLE_CUSTOMER'],
      auth_time: now - 60,
      remember: false,
      sessionVersion: 1,
      exp: now + 10 * 60,
    };

    const result = service.maybeSlideSession(user, claims);
    expect(result).not.toBeNull();
    expect(result?.token).toBe('new-token');
    expect(jwtService.sign).toHaveBeenCalled();
    const signedPayload = sign.mock.calls.at(-1)?.[0];
    expect(signedPayload).toBeDefined();
    if (!signedPayload) {
      throw new Error('Expected the session to be signed');
    }
    expect(signedPayload.auth_time).toBe(claims.auth_time);
    expect(signedPayload.sessionVersion).toBe(1);
  });

  it('does not slide when plenty of idle time remains', () => {
    jwtService.sign.mockClear();
    const claims: SessionJwtClaims = {
      sub: 1,
      email: 'a@b.c',
      roleGroup: RoleGroup.EXTERNAL,
      roles: ['ROLE_CUSTOMER'],
      auth_time: now - 60,
      remember: false,
      sessionVersion: 1,
      exp: now + 40 * 60,
    };
    expect(service.maybeSlideSession(user, claims)).toBeNull();
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('rejects absolute expiry even if idle would slide', () => {
    const claims: SessionJwtClaims = {
      sub: 1,
      email: 'a@b.c',
      roleGroup: RoleGroup.EXTERNAL,
      roles: ['ROLE_CUSTOMER'],
      auth_time: now - 13 * 3600,
      remember: false,
      sessionVersion: 1,
      exp: now + 5 * 60,
    };
    expect(service.isAbsoluteSessionExpired(claims, user)).toBe(true);
    expect(service.maybeSlideSession(user, claims)).toBeNull();
  });
});
