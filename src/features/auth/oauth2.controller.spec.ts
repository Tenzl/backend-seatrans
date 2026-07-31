import type { Request, Response } from 'express';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { OAuth2Controller } from './oauth2.controller';
import type { User } from './entities/user.entity';

describe('OAuth2Controller', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function requestWithState(state?: string): Request {
    return {
      cookies: state ? { oauth_state: state } : {},
    } as unknown as Request;
  }

  it('creates a unique 256-bit state and stores it in a short-lived HttpOnly cookie', () => {
    process.env.NODE_ENV = 'production';
    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          GOOGLE_CLIENT_ID: 'google-client',
          GOOGLE_REDIRECT_URI:
            'https://api.example.test/v1/auth/oauth2/callback/google',
        };
        return values[key];
      }),
    };
    const controller = new OAuth2Controller(
      {} as AuthService,
      configService as unknown as ConfigService,
    );
    const cookie = jest.fn();
    const response = { cookie } as unknown as Response;

    const first = controller.initiateGoogleLogin(response);
    const second = controller.initiateGoogleLogin(response);
    const firstState = new URL(first.authUrl).searchParams.get('state');
    const secondState = new URL(second.authUrl).searchParams.get('state');

    expect(firstState).toBeTruthy();
    expect(Buffer.from(firstState!, 'base64url')).toHaveLength(32);
    expect(secondState).toBeTruthy();
    expect(secondState).not.toBe(firstState);
    expect(cookie).toHaveBeenNthCalledWith(1, 'oauth_state', firstState, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/v1/auth/oauth2/callback/google',
      maxAge: 5 * 60 * 1000,
    });
    expect(cookie).toHaveBeenNthCalledWith(2, 'oauth_state', secondState, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/v1/auth/oauth2/callback/google',
      maxAge: 5 * 60 * 1000,
    });
  });

  it.each([
    ['missing', undefined],
    ['mismatched', 'wrong-state'],
  ])(
    'rejects a %s OAuth state before exchanging the authorization code',
    async (_label, callbackState) => {
      const authService = {
        findOrCreateOAuthUser: jest.fn(),
        buildAuthResponse: jest.fn(),
      };
      const configService = {
        get: jest.fn((key: string, fallback?: string) =>
          key === 'CORS_ORIGINS' ? 'https://www.example.test' : fallback,
        ),
      };
      const controller = new OAuth2Controller(
        authService as unknown as AuthService,
        configService as unknown as ConfigService,
      );
      const clearCookie = jest.fn();
      const redirect = jest.fn();
      const response = { clearCookie, redirect } as unknown as Response;
      global.fetch = jest.fn() as typeof fetch;

      await controller.handleGoogleCallback(
        'google-code',
        callbackState,
        requestWithState('expected-state'),
        response,
      );

      expect(clearCookie).toHaveBeenCalledWith('oauth_state', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/api/v1/auth/oauth2/callback/google',
        maxAge: 5 * 60 * 1000,
      });
      expect(global.fetch).not.toHaveBeenCalled();
      expect(authService.findOrCreateOAuthUser).not.toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith(
        303,
        'https://www.example.test/login?error=oauth_failed',
      );
    },
  );

  it.each([
    ['development', false],
    ['production', true],
  ])(
    'sets the shared auth cookie in %s and redirects without a JWT query',
    async (nodeEnv, secure) => {
      process.env.NODE_ENV = nodeEnv;
      const user = { id: 7, isActive: true } as User;
      const authService = {
        findOrCreateOAuthUser: jest.fn().mockResolvedValue(user),
        buildAuthResponse: jest.fn().mockReturnValue({
          token: 'signed-access-jwt',
          type: 'Bearer',
          user: { id: 7 },
        }),
      };
      const values: Record<string, string> = {
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        GOOGLE_REDIRECT_URI:
          'https://api.example.test/v1/auth/oauth2/callback/google',
        CORS_ORIGINS: 'https://www.example.test,https://admin.example.test',
      };
      const configService = {
        get: jest.fn(
          (key: string, fallback?: string) => values[key] ?? fallback,
        ),
      };
      const controller = new OAuth2Controller(
        authService as unknown as AuthService,
        configService as unknown as ConfigService,
      );
      const cookie = jest.fn();
      const clearCookie = jest.fn();
      const redirect = jest.fn();
      const response = { cookie, clearCookie, redirect } as unknown as Response;
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(
          new global.Response(
            JSON.stringify({ access_token: 'google-access' }),
            {
              status: 200,
            },
          ),
        )
        .mockResolvedValueOnce(
          new global.Response(
            JSON.stringify({
              email: 'user@example.test',
              sub: 'google-user-id',
              email_verified: true,
            }),
            { status: 200 },
          ),
        ) as typeof fetch;

      await controller.handleGoogleCallback(
        'google-code',
        'expected-state',
        requestWithState('expected-state'),
        response,
      );

      expect(clearCookie).toHaveBeenCalledWith('oauth_state', {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/api/v1/auth/oauth2/callback/google',
        maxAge: 5 * 60 * 1000,
      });
      expect(clearCookie.mock.invocationCallOrder[0]).toBeLessThan(
        (global.fetch as jest.Mock).mock.invocationCallOrder[0],
      );
      expect(cookie).toHaveBeenCalledWith('auth_token', 'signed-access-jwt', {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
        maxAge: 1000 * 60 * 60,
      });
      expect(redirect).toHaveBeenCalledWith(303, 'https://www.example.test/');
    },
  );

  it('rejects replay after a valid state has been consumed', async () => {
    const user = { id: 7, isActive: true } as User;
    const authService = {
      findOrCreateOAuthUser: jest.fn().mockResolvedValue(user),
      buildAuthResponse: jest.fn().mockReturnValue({
        token: 'signed-access-jwt',
        type: 'Bearer',
        user: { id: 7 },
      }),
    };
    const values: Record<string, string> = {
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GOOGLE_REDIRECT_URI:
        'https://api.example.test/v1/auth/oauth2/callback/google',
      CORS_ORIGINS: 'https://www.example.test',
    };
    const configService = {
      get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
    };
    const controller = new OAuth2Controller(
      authService as unknown as AuthService,
      configService as unknown as ConfigService,
    );
    const cookie = jest.fn();
    const clearCookie = jest.fn();
    const redirect = jest.fn();
    const response = { cookie, clearCookie, redirect } as unknown as Response;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new global.Response(JSON.stringify({ access_token: 'google-access' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new global.Response(
          JSON.stringify({
            email: 'user@example.test',
            sub: 'google-user-id',
            email_verified: true,
          }),
          { status: 200 },
        ),
      ) as typeof fetch;

    await controller.handleGoogleCallback(
      'google-code',
      'one-time-state',
      requestWithState('one-time-state'),
      response,
    );
    await controller.handleGoogleCallback(
      'replayed-code',
      'one-time-state',
      requestWithState(),
      response,
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(authService.findOrCreateOAuthUser).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenLastCalledWith(
      303,
      'https://www.example.test/login?error=oauth_failed',
    );
  });

  it('returns only a fixed non-sensitive error code when OAuth fails', async () => {
    const configService = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'CORS_ORIGINS') return 'https://www.example.test';
        return fallback;
      }),
    };
    const controller = new OAuth2Controller(
      {} as AuthService,
      configService as unknown as ConfigService,
    );
    const clearCookie = jest.fn();
    const redirect = jest.fn();
    const response = { clearCookie, redirect } as unknown as Response;

    await controller.handleGoogleCallback(
      undefined,
      undefined,
      requestWithState(),
      response,
    );

    expect(redirect).toHaveBeenCalledWith(
      303,
      'https://www.example.test/login?error=oauth_failed',
    );
  });

  it.each([[false], [undefined]])(
    'rejects a Google profile unless email_verified is explicitly true',
    async (emailVerified) => {
      const authService = {
        findOrCreateOAuthUser: jest.fn(),
        buildAuthResponse: jest.fn(),
      };
      const values: Record<string, string> = {
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        GOOGLE_REDIRECT_URI:
          'https://api.example.test/v1/auth/oauth2/callback/google',
        CORS_ORIGINS: 'https://www.example.test',
      };
      const configService = {
        get: jest.fn(
          (key: string, fallback?: string) => values[key] ?? fallback,
        ),
      };
      const controller = new OAuth2Controller(
        authService as unknown as AuthService,
        configService as unknown as ConfigService,
      );
      const clearCookie = jest.fn();
      const redirect = jest.fn();
      const response = { clearCookie, redirect } as unknown as Response;
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(
          new global.Response(
            JSON.stringify({ access_token: 'google-access' }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new global.Response(
            JSON.stringify({
              email: 'user@example.test',
              sub: 'google-user-id',
              email_verified: emailVerified,
            }),
            { status: 200 },
          ),
        ) as typeof fetch;

      await controller.handleGoogleCallback(
        'google-code',
        'expected-state',
        requestWithState('expected-state'),
        response,
      );

      expect(authService.findOrCreateOAuthUser).not.toHaveBeenCalled();
      expect(authService.buildAuthResponse).not.toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith(
        303,
        'https://www.example.test/login?error=oauth_failed',
      );
    },
  );

  it('ignores non-http redirect origins instead of creating an open redirect', async () => {
    const configService = {
      get: jest.fn((key: string, fallback?: string) => {
        if (key === 'CORS_ORIGINS') {
          return 'javascript:alert(1),https://www.example.test';
        }
        return fallback;
      }),
    };
    const controller = new OAuth2Controller(
      {} as AuthService,
      configService as unknown as ConfigService,
    );
    const clearCookie = jest.fn();
    const redirect = jest.fn();
    const response = { clearCookie, redirect } as unknown as Response;

    await controller.handleGoogleCallback(
      undefined,
      undefined,
      requestWithState(),
      response,
    );

    expect(redirect).toHaveBeenCalledWith(
      303,
      'https://www.example.test/login?error=oauth_failed',
    );
  });
});
