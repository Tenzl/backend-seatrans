import type { Request, Response, NextFunction } from 'express';
import { AUTH_COOKIE_NAME } from '../../features/auth/auth-cookie';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

/** Paths that mint or clear the session cookie even when no cookie is present yet. */
const AUTH_COOKIE_MUTATION_PATHS = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/logout',
]);

function headerValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function originFromReferer(referer: string | undefined): string | null {
  return parseOrigin(referer);
}

function hasAuthCookie(req: Request): boolean {
  const cookies = (
    req as Request & { cookies?: Record<string, unknown> }
  ).cookies;
  const token = cookies?.[AUTH_COOKIE_NAME];
  return typeof token === 'string' && token.trim().length > 0;
}

function hasBearerAuthorization(req: Request): boolean {
  const header = headerValue(req.headers.authorization);
  return Boolean(header?.toLowerCase().startsWith('bearer '));
}

function requestPath(req: Request): string {
  // Prefer originalUrl without query; fall back to path/url.
  const raw = req.originalUrl || req.url || req.path || '';
  const pathOnly = raw.split('?')[0];
  // Collapse trailing slash except root.
  if (pathOnly.length > 1 && pathOnly.endsWith('/')) {
    return pathOnly.slice(0, -1);
  }
  return pathOnly;
}

function requiresCsrfCheck(req: Request): boolean {
  const method = (req.method || 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) return false;

  const path = requestPath(req);
  if (AUTH_COOKIE_MUTATION_PATHS.has(path)) return true;

  // Cookie-authenticated mutations are CSRF-sensitive. Pure Bearer clients are not
  // (Authorization is not auto-attached by the browser on cross-site form posts).
  if (hasAuthCookie(req)) return true;
  if (hasBearerAuthorization(req) && !hasAuthCookie(req)) return false;

  return false;
}

/**
 * Origin / Referer CSRF check for cookie credential flows.
 * Aligns with SameSite=Lax auth cookies + CORS_ORIGINS allowlist.
 *
 * Same-origin BFF (dashboard_admin / frontend Next rewrites) sends the browser
 * Origin of the admin/public app; keep those origins in CORS_ORIGINS.
 */
export function createCsrfOriginMiddleware(allowedOrigins: string[]) {
  const allow = new Set(allowedOrigins.map((o) => o.trim()).filter(Boolean));

  return function csrfOriginMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (!requiresCsrfCheck(req)) {
      next();
      return;
    }

    const originHeader = headerValue(req.headers.origin);
    const refererHeader = headerValue(req.headers.referer);
    const origin =
      parseOrigin(originHeader) ?? originFromReferer(refererHeader);

    if (!origin || !allow.has(origin)) {
      res.status(403).json({
        statusCode: 403,
        message: 'Forbidden origin',
        error: 'Forbidden',
      });
      return;
    }

    next();
  };
}
