import { ConflictException } from '@nestjs/common';
import { OptimisticLockVersionMismatchError } from 'typeorm';

const DEFAULT_MESSAGE =
  'Record was modified concurrently; reload and retry';

export function mapOptimisticLockError(
  error: unknown,
  message: string = DEFAULT_MESSAGE,
): never {
  if (error instanceof OptimisticLockVersionMismatchError) {
    throw new ConflictException(message);
  }
  throw error;
}

export async function saveWithOptimisticLock<T>(
  work: () => Promise<T>,
  message: string = DEFAULT_MESSAGE,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    mapOptimisticLockError(error, message);
  }
}
