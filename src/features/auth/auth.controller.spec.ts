import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SectionAccessService } from '../roles/section-access.service';
import { LoginThrottleService } from './login-throttle.service';
import type { Response } from 'express';
import type { Request } from 'express';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { login: jest.Mock; register: jest.Mock };
  let loginThrottle: {
    assertAllowed: jest.Mock;
    delayMsFor: jest.Mock;
    recordSuccess: jest.Mock;
    recordFailure: jest.Mock;
  };
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    authService = { login: jest.fn(), register: jest.fn() };
    loginThrottle = {
      assertAllowed: jest.fn(),
      delayMsFor: jest.fn().mockReturnValue(0),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: SectionAccessService, useValue: {} },
        { provide: LoginThrottleService, useValue: loginThrottle },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it.each([
    ['development', false],
    ['production', true],
  ])('sets a SameSite=Lax HttpOnly cookie in %s', async (nodeEnv, secure) => {
    process.env.NODE_ENV = nodeEnv;
    const auth = {
      token: 'signed-jwt',
      cookieMaxAgeMs: 1000 * 60 * 60,
      user: { id: 1 },
    };
    authService.login.mockResolvedValue(auth);
    const cookie = jest.fn();
    const response = { cookie } as unknown as Response;
    const request = { ip: '127.0.0.1', headers: {} } as unknown as Request;

    const result = await controller.login(
      { identifier: 'user@example.test', password: 'secret' },
      request,
      response,
    );

    expect(loginThrottle.assertAllowed).toHaveBeenCalled();
    expect(loginThrottle.recordSuccess).toHaveBeenCalled();
    expect(cookie).toHaveBeenCalledWith('auth_token', 'signed-jwt', {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 1000 * 60 * 60,
    });
    expect(result).toEqual({ user: { id: 1 } });
    expect(result).not.toHaveProperty('token');
    expect(result).not.toHaveProperty('cookieMaxAgeMs');
  });

  it('does not expose the issued JWT from the registration response', async () => {
    const auth = {
      token: 'signed-jwt',
      cookieMaxAgeMs: 1000 * 60 * 60,
      user: { id: 2, email: 'new@example.test' },
    };
    authService.register.mockResolvedValue(auth);
    const cookie = jest.fn();
    const response = { cookie } as unknown as Response;

    const result = await controller.register(
      {
        email: 'new@example.test',
        password: 'Password1',
        fullName: 'New User',
      },
      response,
    );

    expect(cookie).toHaveBeenCalledWith(
      'auth_token',
      'signed-jwt',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(result).toEqual({
      user: { id: 2, email: 'new@example.test' },
    });
    expect(result).not.toHaveProperty('token');
  });
});
