import { randomUUID } from 'node:crypto';
import { AsyncSemaphore } from '../utils/async-semaphore';
import type { JobQueue } from './job-queue';
import type {
  JobBackend,
  JobHandler,
  JobRecord,
  JobStatus,
} from './queue.types';

type InternalJob = JobRecord & {
  payload: unknown;
  name: string;
  /** Monotonic order for stable terminal prune (ISO timestamps can collide). */
  seq: number;
};

export type InProcessJobQueueOptions = {
  concurrency?: number;
  maxPending?: number;
  /** Max completed/failed jobs retained in memory (default 100). */
  keepTerminal?: number;
  /** Drop terminal jobs older than this many ms (default 5 minutes). */
  terminalTtlMs?: number;
};

/**
 * Bounded in-process queue used when QUEUE_ENABLED=true but REDIS_URL is absent.
 */
export class InProcessJobQueue implements JobQueue {
  readonly backend: JobBackend = 'in-process';

  private readonly handlers = new Map<string, JobHandler>();
  private readonly jobs = new Map<string, InternalJob>();
  private readonly gate: AsyncSemaphore;
  private readonly maxPending: number;
  private readonly keepTerminal: number;
  private readonly terminalTtlMs: number;
  private seqCounter = 0;
  private closed = false;

  constructor(options?: InProcessJobQueueOptions) {
    this.gate = new AsyncSemaphore(options?.concurrency ?? 1);
    this.maxPending = options?.maxPending ?? 20;
    this.keepTerminal = options?.keepTerminal ?? 100;
    this.terminalTtlMs = options?.terminalTtlMs ?? 5 * 60_000;
  }

  /** Test/introspection helper — number of jobs retained in memory. */
  get size(): number {
    return this.jobs.size;
  }

  isEnabled(): boolean {
    return !this.closed;
  }

  registerHandler<TPayload, TResult>(
    name: string,
    handler: JobHandler<TPayload, TResult>,
  ): void {
    this.handlers.set(name, handler as JobHandler);
  }

  async enqueue<TPayload>(name: string, payload: TPayload): Promise<string> {
    if (this.closed) {
      throw new Error('Queue is closed');
    }
    if (!this.handlers.has(name)) {
      throw new Error(`No handler registered for job "${name}"`);
    }

    const pending = [...this.jobs.values()].filter(
      (job) => job.status === 'queued' || job.status === 'active',
    ).length;
    if (pending >= this.maxPending) {
      throw new Error(
        `Queue is full (max pending ${this.maxPending}). Retry later.`,
      );
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const record: InternalJob = {
      id,
      name,
      status: 'queued',
      payload,
      createdAt: now,
      updatedAt: now,
      seq: ++this.seqCounter,
    };
    this.jobs.set(id, record);
    void this.process(id);
    return id;
  }

  async getJob<TResult = unknown>(
    id: string,
  ): Promise<JobRecord<TResult> | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    return {
      id: job.id,
      name: job.name,
      status: job.status,
      result: job.result as TResult | undefined,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private async process(id: string): Promise<void> {
    await this.gate.run(async () => {
      const job = this.jobs.get(id);
      if (!job || this.closed) return;

      const handler = this.handlers.get(job.name);
      if (!handler) {
        this.update(job, 'failed', undefined, `No handler for "${job.name}"`);
        return;
      }

      this.update(job, 'active');
      try {
        const result = await handler(job.payload);
        this.update(job, 'completed', result);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Job failed';
        this.update(job, 'failed', undefined, message);
      }
    });
  }

  private update(
    job: InternalJob,
    status: JobStatus,
    result?: unknown,
    error?: string,
  ): void {
    job.status = status;
    job.updatedAt = new Date().toISOString();
    if (result !== undefined) job.result = result;
    if (error !== undefined) job.error = error;
    if (status === 'completed' || status === 'failed') {
      this.pruneTerminalJobs();
    }
  }

  private pruneTerminalJobs(): void {
    const now = Date.now();
    const terminal = [...this.jobs.values()].filter(
      (job) => job.status === 'completed' || job.status === 'failed',
    );

    for (const job of terminal) {
      const ageMs = now - Date.parse(job.updatedAt);
      if (Number.isFinite(ageMs) && ageMs > this.terminalTtlMs) {
        this.jobs.delete(job.id);
      }
    }

    const remaining = [...this.jobs.values()]
      .filter((job) => job.status === 'completed' || job.status === 'failed')
      .sort((a, b) => b.seq - a.seq);

    for (const job of remaining.slice(this.keepTerminal)) {
      this.jobs.delete(job.id);
    }
  }
}
