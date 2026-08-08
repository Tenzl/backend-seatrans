import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REDIS_CLIENT, type RedisClientLike } from './redis.constants';
import { readPositiveInt } from '../utils/env-int';

/**
 * Short Redis-backed JSON cache. No-ops (always miss) when REDIS_URL is unset.
 * Redis errors are fail-soft: get → miss, set/delete → no-op (never throws).
 */
@Injectable()
export class ShortTtlCacheService {
  private readonly logger = new Logger(ShortTtlCacheService.name);
  private readonly defaultTtlMs: number;

  constructor(
    @Optional()
    @Inject(REDIS_CLIENT)
    private readonly redis: RedisClientLike | null,
    config: ConfigService,
  ) {
    this.defaultTtlMs = readPositiveInt(
      config.get<string>('PUBLIC_CATALOG_CACHE_TTL_MS'),
      60_000,
      { min: 1_000, max: 600_000 },
    );
  }

  isEnabled(): boolean {
    return this.redis != null;
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    } catch (error: unknown) {
      this.logRedisFailure('get', key, error);
      return null;
    }
  }

  async setJson(
    key: string,
    value: unknown,
    ttlMs = this.defaultTtlMs,
  ): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(key, JSON.stringify(value), 'PX', ttlMs);
    } catch (error: unknown) {
      this.logRedisFailure('set', key, error);
    }
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    if (!this.redis) return;
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `${prefix}*`,
          'COUNT',
          64,
        );
        cursor = next;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error: unknown) {
      this.logRedisFailure('deleteByPrefix', prefix, error);
    }
  }

  private logRedisFailure(
    operation: string,
    keyOrPrefix: string,
    error: unknown,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `Redis cache ${operation} failed for "${keyOrPrefix}": ${message}`,
    );
  }
}
