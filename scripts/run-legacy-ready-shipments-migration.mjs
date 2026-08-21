import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  APPLY_CONFIRMATION,
  MIGRATION_ID,
  checksumReadyRecords,
  selectReadyRecords,
  toCreatedAt,
  validateReadyRecords,
} from './lib/legacy-ready-shipments-migration.mjs';

const projectRoot = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const lockName = 'seatrans:legacy-ready-shipments:2026-08-20';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function buildClientConfig() {
  const sslEnabled = [
    'true',
    '1',
    'require',
    'verify-ca',
    'verify-full',
  ].includes(process.env.DB_SSL?.trim().toLowerCase() ?? '');
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'seatrans',
    ssl: sslEnabled
      ? {
          rejectUnauthorized:
            process.env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() ===
            'true',
        }
      : undefined,
    connectionTimeoutMillis: 15_000,
  };
}

function parseArgs(argv) {
  const args = {
    apply: false,
    input: null,
    targetDb: null,
    confirm: null,
    backupOutput: null,
  };
  for (const argument of argv) {
    if (argument === '--apply') args.apply = true;
    else if (argument === '--dry-run') continue;
    else {
      const [key, ...rest] = argument.split('=');
      const value = rest.join('=');
      if (key === '--input') args.input = value;
      else if (key === '--target-db') args.targetDb = value;
      else if (key === '--confirm') args.confirm = value;
      else if (key === '--backup-output') args.backupOutput = value;
      else throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!args.input || !isAbsolute(args.input) || !existsSync(args.input)) {
    throw new Error('--input must be an existing absolute JSON path');
  }
  return args;
}

function assertApplyGuards(args, config) {
  if (!args.apply) return;
  if (args.targetDb !== config.database)
    throw new Error('--target-db must exactly match the configured database');
  if (args.confirm !== APPLY_CONFIRMATION)
    throw new Error(`--confirm must equal ${APPLY_CONFIRMATION}`);
  if (!args.backupOutput || !isAbsolute(args.backupOutput))
    throw new Error('--backup-output must be an absolute path');
  if (existsSync(args.backupOutput))
    throw new Error('--backup-output must not already exist');
  if (
    resolve(args.backupOutput)
      .toLowerCase()
      .startsWith(projectRoot.toLowerCase())
  ) {
    throw new Error('--backup-output must be outside backend2.0');
  }
}

async function tableCounts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int FROM booking_records) AS bookings,
      (SELECT count(*)::int FROM bill_of_lading_records) AS bills,
      (SELECT count(*)::int FROM arrival_notice_records) AS arrivals,
      (SELECT count(*)::int FROM delivery_order_records) AS delivery_orders
  `);
  return result.rows[0];
}

async function verifyMasterData(client, records) {
  const userIds = [...new Set(records.map((record) => record.createdByUserId))];
  const partnerIds = [
    ...new Set(
      records
        .flatMap((record) => [
          record.bookingPayload.clientPartyId,
          record.blPayload.shipperPartyId,
          record.blPayload.consigneePartyId,
        ])
        .filter(Number.isInteger),
    ),
  ];
  const users = await client.query(
    'SELECT id, full_name, is_active FROM users WHERE id = ANY($1::int[]) ORDER BY id',
    [userIds],
  );
  const partners = await client.query(
    'SELECT id, name, deleted_at FROM booking_partners WHERE id = ANY($1::int[]) ORDER BY id',
    [partnerIds],
  );
  const catalogs = await client.query(`
      SELECT 'type' AS kind, id, service_type_id, name FROM commodity_types WHERE id = 177
      UNION ALL
      SELECT 'commodity', id, service_type_id, name FROM commodities WHERE id = 39
      ORDER BY kind
    `);
  if (
    users.rows.length !== userIds.length ||
    users.rows.some((row) => row.is_active !== true)
  ) {
    throw new Error('Referenced creator user is missing or inactive');
  }
  if (
    partners.rows.length !== partnerIds.length ||
    partners.rows.some((row) => row.deleted_at != null)
  ) {
    throw new Error('Referenced partner is missing or archived');
  }
  if (
    catalogs.rows.length !== 2 ||
    catalogs.rows.some((row) => row.service_type_id !== 2)
  ) {
    throw new Error('Freight Forwarding Type/Commodity identity is invalid');
  }
  return {
    users: users.rows,
    partners: partners.rows,
    catalogs: catalogs.rows,
  };
}

async function getLedger(client) {
  const table = await client.query(
    "SELECT to_regclass('public.app_schema_migrations')::text AS name",
  );
  if (!table.rows[0]?.name)
    throw new Error('app_schema_migrations is required');
  const result = await client.query(
    'SELECT migration_id, script_checksum, status, details FROM app_schema_migrations WHERE migration_id = $1',
    [MIGRATION_ID],
  );
  return result.rows[0] ?? null;
}

async function verifyApplied(client, records) {
  const bookings = records.map((record) => record.bookingPayload.bookingNumber);
  const hbls = records.map((record) => record.blPayload.fblNumber);
  const [bookingResult, blResult] = await Promise.all([
    client.query(
      'SELECT count(*)::int AS count FROM booking_records WHERE deleted_at IS NULL AND booking_number = ANY($1::text[])',
      [bookings],
    ),
    client.query(
      'SELECT count(*)::int AS count FROM bill_of_lading_records WHERE deleted_at IS NULL AND fbl_number = ANY($1::text[])',
      [hbls],
    ),
  ]);
  if (
    bookingResult.rows[0].count !== records.length ||
    blResult.rows[0].count !== records.length
  ) {
    throw new Error('Postflight count mismatch');
  }
  return {
    bookings: bookingResult.rows[0].count,
    bills: blResult.rows[0].count,
  };
}

async function snapshot(client, config, records, checksum) {
  const counts = await tableCounts(client);
  const master = await verifyMasterData(client, records);
  return {
    migrationId: MIGRATION_ID,
    database: config.database,
    createdAt: new Date().toISOString(),
    inputChecksum: checksum,
    counts,
    master,
  };
}

async function insertRecords(client, records) {
  const mapping = [];
  for (const record of records) {
    const createdAt = toCreatedAt(record.createdAt);
    const booking = await client.query(
      `INSERT INTO booking_records
        (payload, status, created_by_user_id, created_at, updated_at, booking_flow)
       VALUES ($1::jsonb, 'PROCESSING', $2, $3::timestamptz, $3::timestamptz, 'EXPORT')
       RETURNING id`,
      [
        JSON.stringify(record.bookingPayload),
        record.createdByUserId,
        createdAt,
      ],
    );
    const bookingId = booking.rows[0].id;
    const bill = await client.query(
      `INSERT INTO bill_of_lading_records
        (payload, status, created_by_user_id, created_at, updated_at, booking_id)
       VALUES ($1::jsonb, 'PROCESSING', $2, $3::timestamptz, $3::timestamptz, $4)
       RETURNING id`,
      [
        JSON.stringify(record.blPayload),
        record.createdByUserId,
        createdAt,
        bookingId,
      ],
    );
    mapping.push({
      shipmentId: record.shipmentId,
      sourceChecksum: record.sourceChecksum,
      bookingId: String(bookingId),
      billOfLadingId: String(bill.rows[0].id),
    });
  }
  return mapping;
}

async function main() {
  loadEnvFile(join(projectRoot, '.env'));
  loadEnvFile(join(projectRoot, '.env.local'));
  const args = parseArgs(process.argv.slice(2));
  const config = buildClientConfig();
  assertApplyGuards(args, config);
  const input = JSON.parse(readFileSync(args.input, 'utf8'));
  const records = selectReadyRecords(input);
  const validation = validateReadyRecords(records);
  const checksum = checksumReadyRecords(records);
  const client = new pg.Client(config);
  await client.connect();
  let lockAcquired = false;
  try {
    const ledger = await getLedger(client);
    if (ledger?.status === 'SUCCEEDED') {
      if (ledger.script_checksum !== checksum)
        throw new Error('Migration checksum differs from the applied input');
      const verified = await verifyApplied(client, records);
      console.log(
        JSON.stringify({
          mode: args.apply ? 'apply' : 'dry-run',
          alreadyApplied: true,
          checksum,
          verified,
        }),
      );
      return;
    }
    if (!args.apply) {
      await client.query('BEGIN TRANSACTION READ ONLY');
      const before = await snapshot(client, config, records, checksum);
      if (Object.values(before.counts).some((count) => count !== 0))
        throw new Error('Target booking document tables must be empty');
      await client.query('ROLLBACK');
      console.log(
        JSON.stringify({
          mode: 'dry-run',
          readOnly: true,
          checksum,
          validation,
          before,
        }),
      );
      return;
    }

    const lock = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [lockName],
    );
    lockAcquired = lock.rows[0]?.acquired === true;
    if (!lockAcquired)
      throw new Error('Legacy shipment migration is already running');
    await client.query("SET lock_timeout = '5s'");
    await client.query("SET statement_timeout = '120s'");
    const before = await snapshot(client, config, records, checksum);
    if (Object.values(before.counts).some((count) => count !== 0))
      throw new Error('Target booking document tables must be empty');
    const backupText = `${JSON.stringify(before, null, 2)}\n`;
    writeFileSync(args.backupOutput, backupText, 'utf8');
    const backupChecksum = createHash('sha256')
      .update(backupText)
      .digest('hex');

    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
      const lockedCounts = await tableCounts(client);
      if (Object.values(lockedCounts).some((count) => count !== 0))
        throw new Error('Target changed after preflight');
      await client.query(
        `INSERT INTO app_schema_migrations
          (migration_id, script_checksum, status, backup_reference, logical_export_reference, details, started_at, completed_at)
         VALUES ($1, $2, 'RUNNING', $3, $3, $4::jsonb, NOW(), NULL)`,
        [
          MIGRATION_ID,
          checksum,
          args.backupOutput,
          JSON.stringify({ readyCount: records.length, backupChecksum }),
        ],
      );
      const mapping = await insertRecords(client, records);
      await verifyApplied(client, records);
      await client.query(
        `UPDATE app_schema_migrations
            SET status = 'SUCCEEDED', completed_at = NOW(),
                details = details || $2::jsonb
          WHERE migration_id = $1`,
        [MIGRATION_ID, JSON.stringify({ mapping })],
      );
      await client.query('COMMIT');
      const verified = await verifyApplied(client, records);
      console.log(
        JSON.stringify({
          committed: true,
          checksum,
          backup: args.backupOutput,
          backupChecksum,
          verified,
          mapping,
        }),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    if (lockAcquired)
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]);
    await client.end();
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
