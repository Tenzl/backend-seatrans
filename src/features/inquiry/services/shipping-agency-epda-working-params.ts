import { BadRequestException } from '@nestjs/common';

const MAX_WORKING_PARAMS_BYTES = 256 * 1024;

/**
 * Validate and clone unlocked-draft soft-snapshot tariff params.
 * Kept separate from the lock snapshot service so DB-01 EntityManager work
 * on EPDA save/lock can land without merge conflicts on this helper.
 */
export function normalizeEpdaWorkingParams(
  value: Record<string, unknown>,
): Record<string, unknown> {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new BadRequestException(
      'epdaWorkingParams must be JSON-serializable',
    );
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_WORKING_PARAMS_BYTES) {
    throw new BadRequestException(
      `epdaWorkingParams exceeds maximum size of ${MAX_WORKING_PARAMS_BYTES} bytes`,
    );
  }
  return structuredClone(value);
}
