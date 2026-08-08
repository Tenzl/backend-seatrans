import { resolveCorsOrigins, resolveTrustProxy, validateEnvironment } from './environment';

const validProductionEnvironment = {
  NODE_ENV: 'production',
  APP_JWT_SECRET: 'a'.repeat(48),
  CORS_ORIGINS: 'https://admin.example.test',
  DB_URL: 'postgresql://app:secret@db.example.test:5432/seatrans',
};

describe('runtime environment validation', () => {
  it('normalizes and de-duplicates credentialed CORS origins', () => {
    expect(
      resolveCorsOrigins({
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://admin.example.test/, https://admin.example.test',
      }),
    ).toEqual(['https://admin.example.test']);
  });

  it('uses only the local dashboard fallback outside production', () => {
    expect(resolveCorsOrigins({ NODE_ENV: 'development' })).toEqual([
      'http://localhost:3000',
    ]);
  });

  it('defaults TRUST_PROXY to off and accepts hop counts', () => {
    expect(resolveTrustProxy({})).toBe(false);
    expect(resolveTrustProxy({ TRUST_PROXY: 'false' })).toBe(false);
    expect(resolveTrustProxy({ TRUST_PROXY: 'true' })).toBe(1);
    expect(resolveTrustProxy({ TRUST_PROXY: '2' })).toBe(2);
    expect(() => resolveTrustProxy({ TRUST_PROXY: 'nope' })).toThrow(
      /TRUST_PROXY/,
    );
  });

  it.each([
    ['missing production origins', undefined],
    ['wildcard origin', '*'],
    ['origin with credentials', 'https://user:password@example.test'],
    ['origin with a path', 'https://admin.example.test/private'],
    ['insecure production origin', 'http://admin.example.test'],
  ])('rejects %s', (_label, corsOrigins) => {
    expect(() =>
      resolveCorsOrigins({
        NODE_ENV: 'production',
        CORS_ORIGINS: corsOrigins,
      }),
    ).toThrow();
  });

  it('rejects a weak production JWT secret', () => {
    expect(() =>
      validateEnvironment({
        ...validProductionEnvironment,
        APP_JWT_SECRET: 'short-secret',
      }),
    ).toThrow('APP_JWT_SECRET');
  });

  it('requires complete fallback database credentials in production', () => {
    const withoutUrl: Record<string, unknown> = {
      ...validProductionEnvironment,
    };
    Reflect.deleteProperty(withoutUrl, 'DB_URL');
    expect(() =>
      validateEnvironment({
        ...withoutUrl,
        DB_HOST: 'db.example.test',
        DB_PORT: '5432',
      }),
    ).toThrow('DB_USERNAME');
  });

  it('rejects partial OAuth credentials instead of enabling a broken flow', () => {
    expect(() =>
      validateEnvironment({
        ...validProductionEnvironment,
        GOOGLE_CLIENT_ID: 'google-client',
      }),
    ).toThrow('GOOGLE_CLIENT_SECRET');
  });

  it('returns normalized configuration when production input is valid', () => {
    expect(validateEnvironment(validProductionEnvironment)).toEqual(
      expect.objectContaining({
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://admin.example.test',
        APP_JWT_SECRET: 'a'.repeat(48),
      }),
    );
  });

  it('accepts optional REDIS_URL and QUEUE_ENABLED scaling flags', () => {
    expect(
      validateEnvironment({
        ...validProductionEnvironment,
        REDIS_URL: 'redis://localhost:6379/0',
        QUEUE_ENABLED: 'true',
        QUEUE_CONCURRENCY: '2',
        PUBLIC_CATALOG_CACHE_TTL_MS: '30000',
      }),
    ).toEqual(
      expect.objectContaining({
        REDIS_URL: 'redis://localhost:6379/0',
        QUEUE_ENABLED: 'true',
      }),
    );
  });

  it('rejects an invalid REDIS_URL protocol', () => {
    expect(() =>
      validateEnvironment({
        ...validProductionEnvironment,
        REDIS_URL: 'http://localhost:6379',
      }),
    ).toThrow('REDIS_URL');
  });

  it('rejects a non-boolean QUEUE_ENABLED value', () => {
    expect(() =>
      validateEnvironment({
        ...validProductionEnvironment,
        QUEUE_ENABLED: 'sometimes',
      }),
    ).toThrow('QUEUE_ENABLED');
  });
});
