type EnvironmentInput = Record<string, unknown>;

const VALID_NODE_ENVIRONMENTS = new Set(['development', 'test', 'production']);

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function environmentName(input: EnvironmentInput): string {
  const nodeEnv = optionalString(input.NODE_ENV) ?? 'development';
  if (!VALID_NODE_ENVIRONMENTS.has(nodeEnv)) {
    throw new Error('NODE_ENV must be one of development, test, or production');
  }
  return nodeEnv;
}

function requireValue(input: EnvironmentInput, key: string): string {
  const value = optionalString(input[key]);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function parsePort(value: unknown, key: string, fallback: number): number {
  const raw = optionalString(value);
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${key} must be an integer between 1 and 65535`);
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${key} must be an integer between 1 and 65535`);
  }
  return port;
}

function validateOptionalCredentialGroup(
  input: EnvironmentInput,
  keys: string[],
): void {
  const configured = keys.filter((key) => optionalString(input[key]));
  if (configured.length === 0 || configured.length === keys.length) return;
  const missing = keys.find((key) => !optionalString(input[key]));
  throw new Error(`${missing} is required when ${configured[0]} is configured`);
}

function validateHttpUrl(
  value: string,
  key: string,
  production: boolean,
): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${key} must be a valid HTTP(S) URL`);
  }
  if (production && url.protocol !== 'https:') {
    throw new Error(`${key} must use HTTPS in production`);
  }
  if (url.username || url.password) {
    throw new Error(`${key} must not contain embedded credentials`);
  }
}

/**
 * Whether Express (and login throttle) may honor X-Forwarded-For /
 * CF-Connecting-IP.
 *
 * - unset / false → do not trust client forwarding headers (safe for direct origin)
 * - true / 1 → trust 1 proxy hop (typical nginx / Cloudflare / PaaS edge)
 * - N (integer ≥ 1) → trust N hops
 *
 * Only enable when every public path to the API goes through a known proxy that
 * overwrites these headers. If clients can hit the origin directly, leave this
 * off so attackers cannot rotate XFF to bypass login lockout.
 */
export function resolveTrustProxy(input: EnvironmentInput): false | number {
  const raw = optionalString(input.TRUST_PROXY);
  if (!raw) return false;
  const normalized = raw.toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return 1;
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    if (Number.isInteger(hops) && hops >= 1 && hops <= 32) return hops;
  }
  throw new Error(
    'TRUST_PROXY must be false, true, or a positive hop count (1–32)',
  );
}

export function resolveCorsOrigins(input: EnvironmentInput): string[] {
  const production = environmentName(input) === 'production';
  const rawOrigins = optionalString(input.CORS_ORIGINS);
  if (!rawOrigins && production) {
    throw new Error('CORS_ORIGINS is required in production');
  }

  const candidates = (rawOrigins ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (candidates.length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one origin');
  }

  const origins = candidates.map((candidate) => {
    if (candidate === '*' || candidate.includes('*')) {
      throw new Error('CORS_ORIGINS must not contain wildcard origins');
    }

    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new Error('CORS_ORIGINS contains an invalid origin');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('CORS_ORIGINS supports only HTTP(S) origins');
    }
    if (production && url.protocol !== 'https:') {
      throw new Error('CORS_ORIGINS must use HTTPS in production');
    }
    if (url.username || url.password) {
      throw new Error('CORS_ORIGINS must not contain embedded credentials');
    }
    if (url.pathname !== '/' || url.search || url.hash) {
      throw new Error('CORS_ORIGINS entries must not contain paths or queries');
    }
    return url.origin;
  });

  return [...new Set(origins)];
}

function validateDatabaseConfiguration(
  input: EnvironmentInput,
  production: boolean,
): void {
  const databaseUrl = optionalString(input.DB_URL);
  if (databaseUrl) {
    let url: URL;
    try {
      url = new URL(databaseUrl);
    } catch {
      throw new Error('DB_URL must be a valid PostgreSQL URL');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      throw new Error('DB_URL must use the postgres or postgresql protocol');
    }
    if (!url.hostname || !url.username || !url.password) {
      throw new Error('DB_URL must include host, username, and password');
    }
    if (!url.pathname || url.pathname === '/') {
      throw new Error('DB_URL must include a database name');
    }
    try {
      decodeURIComponent(url.username);
      decodeURIComponent(url.password);
    } catch {
      throw new Error('DB_URL contains invalid credential encoding');
    }
    return;
  }

  if (production) {
    for (const key of [
      'DB_HOST',
      'DB_PORT',
      'DB_USERNAME',
      'DB_PASSWORD',
      'DB_DATABASE',
    ]) {
      requireValue(input, key);
    }
  }
  parsePort(input.DB_PORT, 'DB_PORT', 5432);
}

function parseOptionalBoolean(
  value: unknown,
  key: string,
): boolean | undefined {
  const raw = optionalString(value);
  if (!raw) return undefined;
  const normalized = raw.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${key} must be a boolean (true/false)`);
}

function validateRedisUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL');
  }
  if (!['redis:', 'rediss:'].includes(url.protocol)) {
    throw new Error('REDIS_URL must use the redis or rediss protocol');
  }
}

export function validateEnvironment(input: EnvironmentInput): EnvironmentInput {
  const environment = { ...input };
  const nodeEnv = environmentName(environment);
  const production = nodeEnv === 'production';
  const jwtSecret = requireValue(environment, 'APP_JWT_SECRET');
  if (production && jwtSecret.length < 32) {
    throw new Error(
      'APP_JWT_SECRET must contain at least 32 characters in production',
    );
  }

  const corsOrigins = resolveCorsOrigins(environment);
  // Validate early so bad TRUST_PROXY fails at boot, not on first login.
  resolveTrustProxy(environment);
  const portSource = optionalString(environment.PORT)
    ? environment.PORT
    : environment.SERVER_PORT;
  const port = parsePort(
    portSource,
    optionalString(environment.PORT) ? 'PORT' : 'SERVER_PORT',
    8080,
  );

  validateDatabaseConfiguration(environment, production);
  validateOptionalCredentialGroup(environment, [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
  ]);
  validateOptionalCredentialGroup(environment, [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
  ]);
  validateOptionalCredentialGroup(environment, [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ]);

  const googleRedirectUri = optionalString(environment.GOOGLE_REDIRECT_URI);
  if (googleRedirectUri) {
    validateHttpUrl(googleRedirectUri, 'GOOGLE_REDIRECT_URI', production);
  }

  const redisUrl = optionalString(environment.REDIS_URL);
  if (redisUrl) {
    validateRedisUrl(redisUrl);
  }
  const queueEnabled = parseOptionalBoolean(
    environment.QUEUE_ENABLED,
    'QUEUE_ENABLED',
  );
  if (optionalString(environment.QUEUE_ENABLED) && queueEnabled === undefined) {
    throw new Error('QUEUE_ENABLED must be a boolean (true/false)');
  }
  // Positive ints validated loosely here (runtime also clamps).
  for (const [key, fallback] of [
    ['QUEUE_CONCURRENCY', '1'],
    ['QUEUE_MAX_PENDING', '20'],
    ['PUBLIC_CATALOG_CACHE_TTL_MS', '60000'],
  ] as const) {
    const raw = optionalString(environment[key]);
    if (!raw) continue;
    if (!/^\d+$/.test(raw) || Number(raw) < 1) {
      throw new Error(`${key} must be a positive integer`);
    }
    void fallback;
  }

  return {
    ...environment,
    NODE_ENV: nodeEnv,
    PORT: port,
    CORS_ORIGINS: corsOrigins.join(','),
    APP_JWT_SECRET: jwtSecret,
    ...(redisUrl ? { REDIS_URL: redisUrl } : {}),
    ...(queueEnabled !== undefined
      ? { QUEUE_ENABLED: queueEnabled ? 'true' : 'false' }
      : {}),
  };
}
