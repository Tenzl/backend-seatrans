export type JobBackend = 'disabled' | 'in-process' | 'bullmq';

export type JobStatus = 'queued' | 'active' | 'completed' | 'failed';

export type JobRecord<TResult = unknown> = {
  id: string;
  name: string;
  status: JobStatus;
  result?: TResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type JobHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
) => Promise<TResult>;

export const JOB_QUEUE = Symbol('JOB_QUEUE');

export const BOOKING_PARTNER_IMPORT_PREVIEW_JOB =
  'booking-partner-import-preview';
export const BOOKING_PARTNER_IMPORT_COMMIT_JOB =
  'booking-partner-import-commit';

export type BookingPartnerImportFilePayload = {
  filePath: string;
  actor?: string;
};
