import type { JobBackend } from './queue.types';

export function resolveJobBackend(
  queueEnabled: boolean,
  redisUrl?: string | null,
): JobBackend {
  if (!queueEnabled) return 'disabled';
  return redisUrl?.trim() ? 'bullmq' : 'in-process';
}

export function parseQueueEnabledFlag(raw: string | undefined): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}
