import {
  Global,
  Injectable,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readPositiveInt } from '../utils/env-int';
import { BullMqJobQueue } from './bullmq-job-queue';
import { InProcessJobQueue } from './in-process-job-queue';
import type { JobQueue } from './job-queue';
import { parseQueueEnabledFlag, resolveJobBackend } from './queue.config';
import { JOB_QUEUE, type JobBackend, type JobRecord } from './queue.types';

export { resolveJobBackend } from './queue.config';

@Injectable()
export class JobQueueService implements OnApplicationShutdown {
  private readonly queue: JobQueue;

  constructor(private readonly config: ConfigService) {
    const enabled = parseQueueEnabledFlag(
      this.config.get<string>('QUEUE_ENABLED'),
    );
    const redisUrl = this.config.get<string>('REDIS_URL');
    const backend = resolveJobBackend(enabled, redisUrl);
    const concurrency = readPositiveInt(
      this.config.get<string>('QUEUE_CONCURRENCY'),
      1,
      { min: 1, max: 8 },
    );
    const maxPending = readPositiveInt(
      this.config.get<string>('QUEUE_MAX_PENDING'),
      20,
      { min: 1, max: 200 },
    );

    if (backend === 'bullmq') {
      this.queue = new BullMqJobQueue(redisUrl!.trim());
    } else if (backend === 'in-process') {
      this.queue = new InProcessJobQueue({ concurrency, maxPending });
    } else {
      this.queue = new DisabledJobQueue();
    }
  }

  get backend(): JobBackend {
    return this.queue.backend;
  }

  isEnabled(): boolean {
    return this.queue.isEnabled() && this.queue.backend !== 'disabled';
  }

  registerHandler<TPayload, TResult>(
    name: string,
    handler: (payload: TPayload) => Promise<TResult>,
  ): void {
    this.queue.registerHandler(name, handler);
  }

  enqueue<TPayload>(name: string, payload: TPayload): Promise<string> {
    return this.queue.enqueue(name, payload);
  }

  getJob<TResult = unknown>(id: string) {
    return this.queue.getJob<TResult>(id);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

class DisabledJobQueue implements JobQueue {
  readonly backend: JobBackend = 'disabled';

  isEnabled(): boolean {
    return false;
  }

  registerHandler(): void {
    // no-op
  }

  async enqueue(): Promise<string> {
    throw new Error('QUEUE_ENABLED is false');
  }

  async getJob<TResult = unknown>(): Promise<JobRecord<TResult> | null> {
    return null;
  }

  async close(): Promise<void> {
    // no-op
  }
}

@Global()
@Module({
  providers: [
    JobQueueService,
    {
      provide: JOB_QUEUE,
      useExisting: JobQueueService,
    },
  ],
  exports: [JobQueueService, JOB_QUEUE],
})
export class QueueModule {}
