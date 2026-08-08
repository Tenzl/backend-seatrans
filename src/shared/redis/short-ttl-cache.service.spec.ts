import { ConfigService } from '@nestjs/config';
import { ShortTtlCacheService } from './short-ttl-cache.service';
import type { RedisClientLike } from './redis.constants';

function failingRedis(
  overrides: Partial<RedisClientLike> = {},
): RedisClientLike {
  const boom = async () => {
    throw new Error('Redis unavailable');
  };
  return {
    status: 'end',
    get: boom,
    set: boom,
    del: boom,
    incr: boom,
    pexpire: boom,
    pttl: boom,
    exists: boom,
    scan: boom,
    quit: boom,
    duplicate() {
      return this;
    },
    ...overrides,
  } as RedisClientLike;
}

describe('ShortTtlCacheService fail-soft', () => {
  const config = {
    get: () => '60000',
  } as unknown as ConfigService;

  it('returns null from getJson when Redis throws (cache miss)', async () => {
    const cache = new ShortTtlCacheService(failingRedis(), config);
    await expect(cache.getJson('public:provinces:active:100')).resolves.toBeNull();
  });

  it('swallows setJson Redis errors so callers can return DB results', async () => {
    const cache = new ShortTtlCacheService(failingRedis(), config);
    await expect(
      cache.setJson('public:provinces:active:100', [{ id: 1 }]),
    ).resolves.toBeUndefined();
  });

  it('swallows deleteByPrefix Redis errors', async () => {
    const cache = new ShortTtlCacheService(failingRedis(), config);
    await expect(
      cache.deleteByPrefix('public:provinces:'),
    ).resolves.toBeUndefined();
  });

  it('still serves hits when Redis is healthy', async () => {
    const store = new Map<string, string>();
    const redis = failingRedis({
      async get(key) {
        return store.get(key) ?? null;
      },
      async set(key, value) {
        store.set(key, value);
        return 'OK';
      },
    });
    const cache = new ShortTtlCacheService(redis, config);
    await cache.setJson('k', { ok: true });
    await expect(cache.getJson<{ ok: boolean }>('k')).resolves.toEqual({
      ok: true,
    });
  });

  it('no-ops when REDIS_CLIENT is null', async () => {
    const cache = new ShortTtlCacheService(null, config);
    expect(cache.isEnabled()).toBe(false);
    await expect(cache.getJson('k')).resolves.toBeNull();
    await expect(cache.setJson('k', 1)).resolves.toBeUndefined();
  });
});
