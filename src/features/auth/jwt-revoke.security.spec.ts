import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RoleGroup } from './enums/role-group.enum';
import type { User } from './entities/user.entity';
import type { SessionJwtClaims } from './session-policy';

describe('SEC-01 JWT revoke / isActive / sessionVersion', () => {
  const now = Math.floor(Date.now() / 1000);

  function createAuthService(options?: {
    findOneResult?: User | null;
    increment?: jest.Mock;
    verify?: jest.Mock;
  }) {
    const userRepository = {
      findOne: jest.fn().mockResolvedValue(options?.findOneResult ?? null),
      increment:
        options?.increment ?? jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      query: jest.fn(),
    };
    const jwtService = {
      sign: jest.fn().mockReturnValue('signed-jwt'),
      verify:
        options?.verify ??
        jest.fn().mockReturnValue({
          sub: 1,
          sessionVersion: 1,
        }),
    };
    const configService = {
      get: jest.fn((key: string, fallback?: string) => {
        const map: Record<string, string> = {
          APP_JWT_IDLE: '1h',
          APP_JWT_SLIDE_BEFORE: '15m',
          APP_JWT_ABSOLUTE: '12h',
          APP_JWT_ABSOLUTE_REMEMBER: '7d',
        };
        return map[key] ?? fallback;
      }),
    } as unknown as ConfigService;

    const service = new AuthService(
      userRepository as unknown as Repository<User>,
      {} as never,
      jwtService as unknown as JwtService,
      configService,
      {
        invalidateUser: jest.fn(),
      } as never,
    );

    return { service, userRepository, jwtService };
  }

  function activeUser(overrides?: Partial<User>): User {
    return {
      id: 1,
      email: 'a@b.c',
      isActive: true,
      sessionVersion: 1,
      role: { name: 'ROLE_EMPLOYEE', roleGroup: RoleGroup.INTERNAL },
      ...overrides,
    } as User;
  }

  it('validateUserContext fails closed when user is inactive', async () => {
    const { service } = createAuthService({
      findOneResult: activeUser({ isActive: false }),
    });
    await expect(service.validateUserContext(1, 1)).resolves.toBeNull();
  });

  it('validateUserContext fails closed on sessionVersion mismatch', async () => {
    const { service } = createAuthService({
      findOneResult: activeUser({ sessionVersion: 3 }),
    });
    await expect(service.validateUserContext(1, 1)).resolves.toBeNull();
  });

  it('validateUserContext accepts matching active session', async () => {
    const { service } = createAuthService({
      findOneResult: activeUser({ sessionVersion: 2, password: 'hash' }),
    });
    const user = await service.validateUserContext(1, 2);
    expect(user).toMatchObject({ id: 1, isActive: true, sessionVersion: 2 });
    expect(user).not.toHaveProperty('password');
  });

  it('embeds sessionVersion in issued JWTs', () => {
    const { service, jwtService } = createAuthService();
    service.buildAuthResponse(activeUser({ sessionVersion: 4 }), {
      remember: false,
    });
    const payload = jwtService.sign.mock.calls.at(-1)?.[0] as SessionJwtClaims;
    expect(payload.sessionVersion).toBe(4);
  });

  it('revokeSessionFromToken bumps session_version for a valid token', async () => {
    const increment = jest.fn().mockResolvedValue({ affected: 1 });
    const { service, userRepository } = createAuthService({
      increment,
      verify: jest.fn().mockReturnValue({ sub: 42 }),
    });

    await service.revokeSessionFromToken('valid-jwt');

    expect(userRepository.increment).toHaveBeenCalledWith(
      { id: 42 },
      'sessionVersion',
      1,
    );
  });

  it('revokeSessionFromToken ignores invalid tokens', async () => {
    const increment = jest.fn();
    const { service } = createAuthService({
      increment,
      verify: jest.fn().mockImplementation(() => {
        throw new Error('invalid');
      }),
    });

    await expect(
      service.revokeSessionFromToken('bad-jwt'),
    ).resolves.toBeUndefined();
    expect(increment).not.toHaveBeenCalled();
  });

  describe('JwtStrategy', () => {
    function createStrategy(authService: AuthService) {
      const configService = {
        getOrThrow: jest.fn().mockReturnValue('test-secret'),
      } as unknown as ConfigService;
      return new JwtStrategy(configService, authService);
    }

    it('rejects tokens after disable (inactive user)', async () => {
      const { service } = createAuthService({
        findOneResult: activeUser({ isActive: false }),
      });
      const strategy = createStrategy(service);
      const req = {} as never;

      await expect(
        strategy.validate(req, {
          sub: 1,
          email: 'a@b.c',
          roleGroup: RoleGroup.INTERNAL,
          roles: ['ROLE_EMPLOYEE'],
          auth_time: now - 60,
          remember: false,
          sessionVersion: 1,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects tokens after reset/logout (sessionVersion bumped)', async () => {
      const { service } = createAuthService({
        findOneResult: activeUser({ sessionVersion: 2 }),
      });
      const strategy = createStrategy(service);
      const req = {} as never;

      await expect(
        strategy.validate(req, {
          sub: 1,
          email: 'a@b.c',
          roleGroup: RoleGroup.INTERNAL,
          roles: ['ROLE_EMPLOYEE'],
          auth_time: now - 60,
          remember: false,
          sessionVersion: 1,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects legacy tokens missing sessionVersion', async () => {
      const { service } = createAuthService({
        findOneResult: activeUser(),
      });
      const strategy = createStrategy(service);
      const req = {} as never;

      await expect(
        strategy.validate(req, {
          sub: 1,
          email: 'a@b.c',
          roleGroup: RoleGroup.INTERNAL,
          roles: ['ROLE_EMPLOYEE'],
          auth_time: now - 60,
          remember: false,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('accepts a current active session token', async () => {
      const { service } = createAuthService({
        findOneResult: activeUser({ sessionVersion: 1 }),
      });
      const strategy = createStrategy(service);
      const req: { sessionJwt?: SessionJwtClaims } = {};

      const user = await strategy.validate(req as never, {
        sub: 1,
        email: 'a@b.c',
        roleGroup: RoleGroup.INTERNAL,
        roles: ['ROLE_EMPLOYEE'],
        auth_time: now - 60,
        remember: false,
        sessionVersion: 1,
      });

      expect(user.id).toBe(1);
      expect(req.sessionJwt?.sessionVersion).toBe(1);
    });
  });
});
