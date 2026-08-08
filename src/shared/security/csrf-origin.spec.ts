import type { Request } from 'express';
import { createCsrfOriginMiddleware } from './csrf-origin';

function mockReq(
  partial: Partial<Request> & {
    method?: string;
    originalUrl?: string;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
  },
): Request {
  return {
    method: 'POST',
    originalUrl: '/api/v1/admin/ports',
    url: '/api/v1/admin/ports',
    path: '/api/v1/admin/ports',
    cookies: {},
    headers: {},
    ...partial,
  } as unknown as Request;
}

describe('csrf Origin middleware (SEC-05)', () => {
  const allowed = ['http://localhost:3000', 'https://admin.example.test'];

  function run(req: Request): { status?: number; body?: unknown; next: boolean } {
    const middleware = createCsrfOriginMiddleware(allowed);
    let status: number | undefined;
    let body: unknown;
    let next = false;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
    };
    middleware(req, res as never, () => {
      next = true;
    });
    return { status, body, next };
  }

  it('allows safe methods without Origin', () => {
    const result = run(
      mockReq({ method: 'GET', cookies: { auth_token: 'jwt' } }),
    );
    expect(result.next).toBe(true);
  });

  it('allows cookie mutations from an allowlisted Origin', () => {
    const result = run(
      mockReq({
        cookies: { auth_token: 'jwt' },
        headers: { origin: 'https://admin.example.test' },
      }),
    );
    expect(result.next).toBe(true);
  });

  it('rejects cookie mutations from a foreign Origin', () => {
    const result = run(
      mockReq({
        cookies: { auth_token: 'jwt' },
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(result.next).toBe(false);
    expect(result.status).toBe(403);
  });

  it('falls back to Referer when Origin is absent', () => {
    const result = run(
      mockReq({
        cookies: { auth_token: 'jwt' },
        headers: { referer: 'http://localhost:3000/dashboard' },
      }),
    );
    expect(result.next).toBe(true);
  });

  it('always checks login even without a session cookie', () => {
    const blocked = run(
      mockReq({
        originalUrl: '/api/v1/auth/login',
        path: '/api/v1/auth/login',
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(blocked.status).toBe(403);

    const ok = run(
      mockReq({
        originalUrl: '/api/v1/auth/login',
        path: '/api/v1/auth/login',
        headers: { origin: 'http://localhost:3000' },
      }),
    );
    expect(ok.next).toBe(true);
  });

  it('skips Origin check for Bearer-only clients without a session cookie', () => {
    const result = run(
      mockReq({
        headers: {
          authorization: 'Bearer script-token',
          origin: 'https://evil.example',
        },
      }),
    );
    expect(result.next).toBe(true);
  });
});
