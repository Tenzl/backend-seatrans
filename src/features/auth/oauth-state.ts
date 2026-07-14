import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';

export const OAUTH_STATE_COOKIE_NAME = 'oauth_state';
export const OAUTH_STATE_COOKIE_MAX_AGE_MS = 5 * 60 * 1000;

const OAUTH_CALLBACK_PATH = '/api/v1/auth/oauth2/callback/google';

function oauthStateCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: OAUTH_CALLBACK_PATH,
    maxAge: OAUTH_STATE_COOKIE_MAX_AGE_MS,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hashState(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** A 256-bit, URL-safe nonce for binding one browser to one OAuth callback. */
export function generateOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

export function setOAuthStateCookie(res: Response, state: string): void {
  res.cookie(OAUTH_STATE_COOKIE_NAME, state, oauthStateCookieOptions());
}

/**
 * Consume the state before any provider token exchange. The cookie is cleared for
 * success and failure paths, while fixed-length hashes keep comparison timing
 * independent of attacker-controlled state length.
 */
export function consumeOAuthState(
  req: Request,
  res: Response,
  receivedState?: string,
): boolean {
  const cookies: unknown = req.cookies;
  const storedValue = isRecord(cookies)
    ? cookies[OAUTH_STATE_COOKIE_NAME]
    : undefined;
  const storedState = typeof storedValue === 'string' ? storedValue : '';
  const candidateState = typeof receivedState === 'string' ? receivedState : '';

  if (isRecord(cookies)) {
    delete cookies[OAUTH_STATE_COOKIE_NAME];
  }
  res.clearCookie(OAUTH_STATE_COOKIE_NAME, oauthStateCookieOptions());

  const matches = timingSafeEqual(
    hashState(storedState),
    hashState(candidateState),
  );
  return storedState.length > 0 && candidateState.length > 0 && matches;
}
