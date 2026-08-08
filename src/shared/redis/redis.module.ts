import {
  Global,
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT, type RedisClientLike } from './redis.constants';
import { ShortTtlCacheService } from './short-ttl-cache.service';

@Injectable()
class RedisClientShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: RedisClientLike | null,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch {
      // Best-effort close on shutdown.
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): RedisClientLike | null => {
        const redisUrl = config.get<string>('REDIS_URL')?.trim();
        if (!redisUrl) {
          return null;
        }
        return new Redis(redisUrl, {
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
          lazyConnect: false,
        }) as unknown as RedisClientLike;
      },
    },
    ShortTtlCacheService,
    RedisClientShutdown,
  ],
  exports: [REDIS_CLIENT, ShortTtlCacheService],
})
export class RedisModule {}
