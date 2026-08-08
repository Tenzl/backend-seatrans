import { Queue, Worker, type JobsOptions } from 'bullmq';
import type { JobQueue } from './job-queue';
import type {
  JobBackend,
  JobHandler,
  JobRecord,
  JobStatus,
} from './queue.types';

type RedisConnectionOptions = {
  url: string;
  maxRetriesPerRequest: null;
  enableReadyCheck: boolean;
};

/**
 * BullMQ-backed queue used when QUEUE_ENABLED=true and REDIS_URL is set.
 * Passes connection options (not a shared ioredis instance) so Queue/Worker
 * each get a dedicated connection.
 */
export class BullMqJobQueue implements JobQueue {
  readonly backend: JobBackend = 'bullmq';

  private readonly handlers = new Map<string, JobHandler>();
  private readonly connection: RedisConnectionOptions;
  private readonly queue: Queue;
  private worker: Worker | null = null;
  private closed = false;

  constructor(
    redisUrl: string,
    private readonly queueName = 'seatrans-jobs',
  ) {
    this.connection = {
      url: redisUrl,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    };
    this.queue = new Queue(this.queueName, { connection: this.connection });
  }

  isEnabled(): boolean {
    return !this.closed;
  }

  registerHandler<TPayload, TResult>(
    name: string,
    handler: JobHandler<TPayload, TResult>,
  ): void {
    this.handlers.set(name, handler as JobHandler);
    this.ensureWorker();
  }

  async enqueue<TPayload>(name: string, payload: TPayload): Promise<string> {
    if (this.closed) {
      throw new Error('Queue is closed');
    }
    if (!this.handlers.has(name)) {
      throw new Error(`No handler registered for job "${name}"`);
    }

    const options: JobsOptions = {
      removeOnComplete: { age: 3600, count: 100 },
      removeOnFail: { age: 86_400, count: 200 },
    };
    const job = await this.queue.add(name, payload, options);
    return String(job.id);
  }

  async getJob<TResult = unknown>(
    id: string,
  ): Promise<JobRecord<TResult> | null> {
    const job = await this.queue.getJob(id);
    if (!job) return null;

    const state = await job.getState();
    const status = this.mapState(state);
    const createdAt = new Date(job.timestamp).toISOString();
    const updatedAt = new Date(
      job.finishedOn ?? job.processedOn ?? job.timestamp,
    ).toISOString();

    return {
      id: String(job.id),
      name: job.name,
      status,
      result: (job.returnvalue ?? undefined) as TResult | undefined,
      error: job.failedReason || undefined,
      createdAt,
      updatedAt,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.worker?.close();
    await this.queue.close();
  }

  private ensureWorker(): void {
    if (this.worker) return;
    this.worker = new Worker(
      this.queueName,
      async (job) => {
        const handler = this.handlers.get(job.name);
        if (!handler) {
          throw new Error(`No handler registered for job "${job.name}"`);
        }
        return handler(job.data);
      },
      {
        connection: this.connection,
        concurrency: 1,
      },
    );
  }

  private mapState(state: string): JobStatus {
    switch (state) {
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      case 'active':
        return 'active';
      case 'waiting':
      case 'delayed':
      case 'paused':
      case 'waiting-children':
      default:
        return 'queued';
    }
  }
}
