import { readPositiveInt } from '../../../shared/utils/env-int';

/** Hard caps so a huge sheet cannot OOM / stall the process (PERF-03). */
export const BOOKING_PARTNER_IMPORT_MAX_ROWS = readPositiveInt(
  process.env.BOOKING_PARTNER_IMPORT_MAX_ROWS,
  2_000,
  { min: 1, max: 20_000 },
);

export const BOOKING_PARTNER_IMPORT_MAX_COLUMNS = readPositiveInt(
  process.env.BOOKING_PARTNER_IMPORT_MAX_COLUMNS,
  64,
  { min: 1, max: 256 },
);

export const BOOKING_PARTNER_IMPORT_PARSE_CONCURRENCY = readPositiveInt(
  process.env.BOOKING_PARTNER_IMPORT_PARSE_CONCURRENCY,
  1,
  { min: 1, max: 4 },
);
