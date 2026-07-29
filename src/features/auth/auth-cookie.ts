import type { CookieOptions, Response } from 'express';

export const AUTH_COOKIE_NAME = 'auth_token';

/** Default cookie lifetime when caller does not pass an explicit maxAge (idle TTL). */
export const DEFAULT_AUTH_COOKIE_MAX_AGE_MS = 1000 * 60 * 60;

export function authCookieOptions(maxAgeMs?: number): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge:
      maxAgeMs != null && Number.isFinite(maxAgeMs) && maxAgeMs > 0
        ? Math.floor(maxAgeMs)
        : DEFAULT_AUTH_COOKIE_MAX_AGE_MS,
  };
}

export function setAuthCookie(
  res: Response,
  token: string,
  maxAgeMs?: number,
): void {
  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions(maxAgeMs));
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, authCookieOptions());
}
