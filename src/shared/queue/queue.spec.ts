import { InProcessJobQueue } from './in-process-job-queue';
import { resolveJobBackend } from './queue.config';
import { ThrottlerRedisStorage } from '../redis/throttler-redis.storage';
import type { RedisClientLike } from '../redis/redis.constants';

describe('resolveJobBackend', () => {
  it('disables the queue when QUEUE_ENABLED is false', () => {
    expect(resolveJobBackend(false, 'redis://localhost:6379')).toBe('disabled');
    expect(resolveJobBackend(false, null)).toBe('disabled');
  });

  it('selects BullMQ when enabled and REDIS_URL is present', () => {
    expect(resolveJobBackend(true, 'redis://localhost:6379')).toBe('bullmq');
  });

  it('falls back to in-process when enabled without Redis', () => {
    expect(resolveJobBackend(true, null)).toBe('in-process');
    expect(resolveJobBackend(true, '   ')).toBe('in-process');
  });
});

describe('InProcessJobQueue', () => {
  it('registers handlers, enqueues work, and returns completed results', async () => {
    const queue = new InProcessJobQueue({ concurrency: 1, maxPending: 4 });
    queue.registerHandler<{ value: number }, { doubled: number }>(
      'double',
      async (payload) => ({ doubled: payload.value * 2 }),
    );

    const jobId = await queue.enqueue('double', { value: 21 });
    await waitFor(
      async () => (await queue.getJob(jobId))?.status === 'completed',
    );

    const job = await queue.getJob<{ doubled: number }>(jobId);
    expect(job).toEqual(
      expect.objectContaining({
        id: jobId,
        name: 'double',
        status: 'completed',
        result: { doubled: 42 },
      }),
    );

    await queue.close();
  });

  it('rejects enqueue when the pending bound is exceeded', async () => {
    const queue = new InProcessJobQueue({ concurrency: 1, maxPending: 1 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    queue.registerHandler('slow', async () => {
      await gate;
      return { ok: true };
    });

    await queue.enqueue('slow', {});
    await expect(queue.enqueue('slow', {})).rejects.toThrow(/Queue is full/);
    release();
    await queue.close();
  });

  it('prunes completed/failed jobs beyond keepTerminal', async () => {
    const queue = new InProcessJobQueue({
      concurrency: 1,
      maxPending: 20,
      keepTerminal: 2,
      terminalTtlMs: 60_000,
    });
    queue.registerHandler('noop', async () => ({ ok: true }));

    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push(await queue.enqueue('noop', { i }));
    }
    await waitFor(async () => queue.size <= 2);

    expect(queue.size).toBe(2);
    expect(await queue.getJob(ids[0]!)).toBeNull();
    expect(await queue.getJob(ids[1]!)).toBeNull();
    expect(await queue.getJob(ids[2]!)).toBeNull();
    expect((await queue.getJob(ids[3]!))?.status).toBe('completed');
    expect((await queue.getJob(ids[4]!))?.status).toBe('completed');

    await queue.close();
  });

  it('prunes terminal jobs past terminalTtlMs', async () => {
    const queue = new InProcessJobQueue({
      concurrency: 1,
      maxPending: 10,
      keepTerminal: 50,
      terminalTtlMs: 1,
    });
    queue.registerHandler('noop', async () => ({ ok: true }));

    const jobId = await queue.enqueue('noop', {});
    await waitFor(
      async () => (await queue.getJob(jobId))?.status === 'completed',
    );
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Trigger another prune cycle via a new completion.
    const secondId = await queue.enqueue('noop', {});
    await waitFor(async () => (await queue.getJob(jobId)) === null);

    expect(await queue.getJob(secondId)).not.toBeNull();
    await queue.close();
  });
});

describe('ThrottlerRedisStorage', () => {
  it('increments hits and sets TTL on first touch', async () => {
    const store = new Map<string, { value: string; expiresAt?: number }>();
    const redis: RedisClientLike = {
      status: 'ready',
      async get(key) {
        return store.get(key)?.value ?? null;
      },
      async set(key, value, expiryMode, time) {
        store.set(key, {
          value,
          expiresAt:
            expiryMode === 'PX' && typeof time === 'number'
              ? Date.now() + time
              : undefined,
        });
        return 'OK';
      },
      async del(...keys) {
        let removed = 0;
        for (const key of keys) {
          if (store.delete(key)) removed += 1;
        }
        return removed;
      },
      async incr(key) {
        const current = Number(store.get(key)?.value ?? '0');
        const next = current + 1;
        store.set(key, { value: String(next), expiresAt: store.get(key)?.expiresAt });
        return next;
      },
      async pexpire(key, ms) {
        const entry = store.get(key);
        if (!entry) return 0;
        entry.expiresAt = Date.now() + ms;
        return 1;
      },
      async pttl(key) {
        const entry = store.get(key);
        if (!entry) return -2;
        if (entry.expiresAt == null) return -1;
        return Math.max(0, entry.expiresAt - Date.now());
      },
      async exists(...keys) {
        return keys.filter((key) => store.has(key)).length;
      },
      async scan() {
        return ['0', []];
      },
      async quit() {
        return 'OK';
      },
      duplicate() {
        return redis;
      },
    };

    const storage = new ThrottlerRedisStorage(redis);
    const first = await storage.increment('ip:1', 60_000, 5, 0, 'default');
    expect(first.totalHits).toBe(1);
    expect(first.isBlocked).toBe(false);
    expect(first.timeToExpire).toBeGreaterThan(0);

    const second = await storage.increment('ip:1', 60_000, 5, 0, 'default');
    expect(second.totalHits).toBe(2);
  });

  it('marks the tracker blocked after exceeding the limit', async () => {
    const hits = { count: 0 };
    const blocked = new Map<string, number>();
    const redis = {
      status: 'ready',
      async get() {
        return null;
      },
      async set(key: string, _value: string, expiryMode?: string, time?: number) {
        if (key.includes(':block') && expiryMode === 'PX' && time) {
          blocked.set(key, Date.now() + time);
        }
        return 'OK';
      },
      async del() {
        return 0;
      },
      async incr() {
        hits.count += 1;
        return hits.count;
      },
      async pexpire() {
        return 1;
      },
      async pttl(key: string) {
        if (key.includes(':block')) {
          const expiresAt = blocked.get(key);
          return expiresAt ? Math.max(0, expiresAt - Date.now()) : -2;
        }
        return 30_000;
      },
      async exists(key: string) {
        return blocked.has(key) ? 1 : 0;
      },
      async scan() {
        return ['0', []] as [string, string[]];
      },
      async quit() {
        return 'OK';
      },
      duplicate() {
        return redis;
      },
    } as unknown as RedisClientLike;

    const storage = new ThrottlerRedisStorage(redis);
    await storage.increment('ip:2', 60_000, 1, 5_000, 'default');
    const blockedHit = await storage.increment(
      'ip:2',
      60_000,
      1,
      5_000,
      'default',
    );
    expect(blockedHit.isBlocked).toBe(true);
    expect(blockedHit.timeToBlockExpire).toBeGreaterThan(0);
  });

  it('falls back to in-memory when Redis increment fails', async () => {
    const redis = {
      status: 'end',
      async exists() {
        throw new Error('ECONNREFUSED');
      },
      async get() {
        throw new Error('ECONNREFUSED');
      },
      async set() {
        throw new Error('ECONNREFUSED');
      },
      async del() {
        throw new Error('ECONNREFUSED');
      },
      async incr() {
        throw new Error('ECONNREFUSED');
      },
      async pexpire() {
        throw new Error('ECONNREFUSED');
      },
      async pttl() {
        throw new Error('ECONNREFUSED');
      },
      async scan() {
        throw new Error('ECONNREFUSED');
      },
      async quit() {
        return 'OK';
      },
      duplicate() {
        return redis;
      },
    } as unknown as RedisClientLike;

    const storage = new ThrottlerRedisStorage(redis);
    const first = await storage.increment('ip:down', 60_000, 5, 0, 'default');
    expect(first.totalHits).toBe(1);
    expect(first.isBlocked).toBe(false);

    const second = await storage.increment('ip:down', 60_000, 5, 0, 'default');
    expect(second.totalHits).toBe(2);
    storage.dispose();
  });
});

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for job completion');
}
