/**
 * Session lifetime policy for cookie JWT auth.
 *
 * - Idle (sliding window): token `exp` — inactivity longer than this ends the session
 *   unless refreshed by authenticated activity.
 * - Absolute: wall-clock max from `auth_time` (login) — cannot be extended by activity.
 * - Remember (EXTERNAL only): longer absolute ceiling when login sent remember=true.
 */

export type JwtExpirationInput = number | `${number}${string}`;

const DURATION_RE =
  /^(\d+(?:\.\d+)?)\s*(years?|yrs?|y|weeks?|w|days?|d|hours?|hrs?|hr|h|minutes?|mins?|min|m|seconds?|secs?|sec|s|milliseconds?|msecs?|msec|ms)?$/i;

const UNIT_SECONDS: Record<string, number> = {
  year: 365 * 24 * 3600,
  years: 365 * 24 * 3600,
  yr: 365 * 24 * 3600,
  yrs: 365 * 24 * 3600,
  y: 365 * 24 * 3600,
  week: 7 * 24 * 3600,
  weeks: 7 * 24 * 3600,
  w: 7 * 24 * 3600,
  day: 24 * 3600,
  days: 24 * 3600,
  d: 24 * 3600,
  hour: 3600,
  hours: 3600,
  hr: 3600,
  hrs: 3600,
  h: 3600,
  minute: 60,
  minutes: 60,
  min: 60,
  mins: 60,
  m: 60,
  second: 1,
  seconds: 1,
  sec: 1,
  secs: 1,
  s: 1,
  millisecond: 0.001,
  milliseconds: 0.001,
  msec: 0.001,
  msecs: 0.001,
  ms: 0.001,
};

/** Parse "15m" / "12h" / "7d" / bare seconds into whole seconds. */
export function parseDurationToSeconds(
  value: string | undefined,
  fallbackSeconds: number,
): number {
  if (!value?.trim()) return fallbackSeconds;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallbackSeconds;
  }
  const match = DURATION_RE.exec(trimmed);
  if (!match) return fallbackSeconds;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallbackSeconds;
  const unitKey = (match[2] ?? 's').toLowerCase();
  const unit = UNIT_SECONDS[unitKey];
  if (unit == null) return fallbackSeconds;
  const seconds = Math.floor(amount * unit);
  return seconds > 0 ? seconds : fallbackSeconds;
}

export function toJwtExpiresIn(seconds: number): JwtExpirationInput {
  return Math.max(1, Math.floor(seconds));
}

export interface SessionPolicyConfig {
  /** Inactivity / sliding token TTL (default 1h). */
  idleSeconds: number;
  /** Refresh when remaining TTL is below this (default 15m). */
  slideBeforeSeconds: number;
  /** Absolute max from login for normal sessions (default 12h). */
  absoluteSeconds: number;
  /** Absolute max when remember=true and EXTERNAL (default 7d). */
  absoluteRememberSeconds: number;
}

export const DEFAULT_SESSION_POLICY: SessionPolicyConfig = {
  idleSeconds: 60 * 60,
  slideBeforeSeconds: 15 * 60,
  absoluteSeconds: 12 * 60 * 60,
  absoluteRememberSeconds: 7 * 24 * 60 * 60,
};

export function loadSessionPolicyFromEnv(env: {
  get: (key: string, defaultValue?: string) => string | undefined;
}): SessionPolicyConfig {
  // Prefer APP_JWT_IDLE; fall back to legacy APP_JWT_EXPIRATION then 1h.
  const idleRaw =
    env.get('APP_JWT_IDLE') ?? env.get('APP_JWT_EXPIRATION') ?? '1h';
  return {
    idleSeconds: parseDurationToSeconds(
      idleRaw,
      DEFAULT_SESSION_POLICY.idleSeconds,
    ),
    slideBeforeSeconds: parseDurationToSeconds(
      env.get('APP_JWT_SLIDE_BEFORE', '15m'),
      DEFAULT_SESSION_POLICY.slideBeforeSeconds,
    ),
    absoluteSeconds: parseDurationToSeconds(
      env.get('APP_JWT_ABSOLUTE', '12h'),
      DEFAULT_SESSION_POLICY.absoluteSeconds,
    ),
    absoluteRememberSeconds: parseDurationToSeconds(
      env.get('APP_JWT_ABSOLUTE_REMEMBER', '7d'),
      DEFAULT_SESSION_POLICY.absoluteRememberSeconds,
    ),
  };
}

export interface SessionJwtClaims {
  sub: number;
  email: string;
  roleGroup?: string | null;
  roles: string[];
  /** Unix seconds at original login — never changes on sliding refresh. */
  auth_time: number;
  remember: boolean;
  iat?: number;
  exp?: number;
}

export function resolveAbsoluteSeconds(
  policy: SessionPolicyConfig,
  opts: { remember: boolean; roleGroup?: string | null },
): number {
  const isExternal = (opts.roleGroup ?? '').toUpperCase() === 'EXTERNAL';
  if (opts.remember && isExternal) {
    return policy.absoluteRememberSeconds;
  }
  return policy.absoluteSeconds;
}

export function remainingAbsoluteSeconds(
  authTime: number,
  absoluteSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): number {
  return authTime + absoluteSeconds - nowSeconds;
}

export function shouldSlideSession(
  exp: number | undefined,
  slideBeforeSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (exp == null || !Number.isFinite(exp)) return false;
  const remaining = exp - nowSeconds;
  return remaining > 0 && remaining <= slideBeforeSeconds;
}
