import type {
  JobBackend,
  JobHandler,
  JobRecord,
} from './queue.types';

export interface JobQueue {
  readonly backend: JobBackend;
  isEnabled(): boolean;
  registerHandler<TPayload, TResult>(
    name: string,
    handler: JobHandler<TPayload, TResult>,
  ): void;
  enqueue<TPayload>(name: string, payload: TPayload): Promise<string>;
  getJob<TResult = unknown>(id: string): Promise<JobRecord<TResult> | null>;
  close(): Promise<void>;
}
