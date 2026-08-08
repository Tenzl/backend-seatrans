import { Logger } from '@nestjs/common';
import {
  ThrottlerStorageService,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type { RedisClientLike } from './redis.constants';

/**
 * Distributed Nest Throttler storage backed by Redis.
 * Used only when REDIS_URL is configured.
 * On Redis errors, falls back to in-memory throttling so requests are not 500'd.
 */
export class ThrottlerRedisStorage implements ThrottlerStorage {
  private readonly logger = new Logger(ThrottlerRedisStorage.name);
  private readonly memoryFallback = new ThrottlerStorageService();
  private warnedFallback = false;

  constructor(private readonly redis: RedisClientLike) {}

  /** Clears in-memory fallback timers (tests / optional shutdown). */
  dispose(): void {
    this.memoryFallback.onApplicationShutdown();
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      return await this.incrementRedis(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    } catch (error: unknown) {
      if (!this.warnedFallback) {
        this.warnedFallback = true;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Redis throttler storage failed; falling back to in-memory for this process: ${message}`,
        );
      }
      return this.memoryFallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }

  private async incrementRedis(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `throttler:${throttlerName}:${key}:hits`;
    const blockKey = `throttler:${throttlerName}:${key}:block`;

    const blocked = (await this.redis.exists(blockKey)) > 0;
    if (blocked) {
      const blockPttl = await this.redis.pttl(blockKey);
      return {
        totalHits: limit + 1,
        timeToExpire: 0,
        isBlocked: true,
        timeToBlockExpire: Math.max(0, Math.ceil(blockPttl / 1000)),
      };
    }

    const totalHits = await this.redis.incr(hitKey);
    let hitPttl = await this.redis.pttl(hitKey);
    if (hitPttl < 0) {
      await this.redis.pexpire(hitKey, ttl);
      hitPttl = ttl;
    }

    let isBlocked = false;
    let timeToBlockExpire = 0;
    if (totalHits > limit && blockDuration > 0) {
      await this.redis.set(blockKey, '1', 'PX', blockDuration);
      isBlocked = true;
      timeToBlockExpire = Math.ceil(blockDuration / 1000);
    }

    return {
      totalHits,
      timeToExpire: Math.max(0, Math.ceil(hitPttl / 1000)),
      isBlocked,
      timeToBlockExpire,
    };
  }
}
