import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SectionAccessService } from '../roles/section-access.service';
import type { Response } from 'express';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { login: jest.Mock };
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    authService = { login: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: SectionAccessService, useValue: {} },
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
    const auth = { token: 'signed-jwt' };
    authService.login.mockResolvedValue(auth);
    const cookie = jest.fn();
    const response = { cookie } as unknown as Response;

    await controller.login(
      { identifier: 'user@example.test', password: 'secret' },
      response,
    );

    expect(cookie).toHaveBeenCalledWith('auth_token', 'signed-jwt', {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 1000 * 60 * 60 * 24,
    });
  });
});
