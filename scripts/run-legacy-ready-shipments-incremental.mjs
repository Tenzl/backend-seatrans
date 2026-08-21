import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { toCreatedAt } from './lib/legacy-ready-shipments-migration.mjs';
import {
  APPLY_CONFIRMATION,
  MIGRATION_ID,
  SIMULATE_CONFIRMATION,
  checksumIncrementalRecords,
  checksumProtectedRows,
  selectNewlyReadyRecords,
  validateIncrementalRecords,
} from './lib/legacy-ready-shipments-incremental.mjs';

const projectRoot = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const lockName = 'seatrans:legacy-ready-shipments-incremental:2026-08-20';
const firstMigrationId = '2026-08-20_legacy_ready_shipments_v1';

function loadEnv(path) {
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

function clientConfig() {
  const ssl = ['true', '1', 'require', 'verify-ca', 'verify-full'].includes(
    process.env.DB_SSL?.trim().toLowerCase() ?? '',
  );
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'seatrans',
    ssl: ssl
      ? {
          rejectUnauthorized:
            process.env.DB_SSL_REJECT_UNAUTHORIZED?.toLowerCase() === 'true',
        }
      : undefined,
    connectionTimeoutMillis: 15_000,
  };
}

export function parseArgs(argv) {
  const args = {
    apply: false,
    simulate: false,
    input: null,
    baseline: null,
    targetDb: null,
    confirm: null,
    backupOutput: null,
  };
  for (const argument of argv) {
    if (argument === '--apply') args.apply = true;
    else if (argument === '--simulate') args.simulate = true;
    else if (argument === '--dry-run') continue;
    else {
      const [key, ...rest] = argument.split('=');
      const value = rest.join('=');
      if (key === '--input') args.input = value;
      else if (key === '--baseline') args.baseline = value;
      else if (key === '--target-db') args.targetDb = value;
      else if (key === '--confirm') args.confirm = value;
      else if (key === '--backup-output') args.backupOutput = value;
      else throw new Error(`Unknown argument: ${argument}`);
    }
  }
  for (const [name, value] of [
    ['input', args.input],
    ['baseline', args.baseline],
  ]) {
    if (!value || !isAbsolute(value) || !existsSync(value)) {
      throw new Error(`--${name} must be an existing absolute JSON path`);
    }
  }
  return args;
}

export function assertApplyGuards(args, config) {
  if (!args.apply && !args.simulate) return;
  if (args.targetDb !== config.database) {
    throw new Error('--target-db must exactly match the configured database');
  }
  if (args.apply && args.simulate) {
    throw new Error('--apply and --simulate are mutually exclusive');
  }
  if (args.simulate) {
    if (args.confirm !== SIMULATE_CONFIRMATION) {
      throw new Error(`--confirm must equal ${SIMULATE_CONFIRMATION}`);
    }
    return;
  }
  if (args.confirm !== APPLY_CONFIRMATION) {
    throw new Error(`--confirm must equal ${APPLY_CONFIRMATION}`);
  }
  if (!args.backupOutput || !isAbsolute(args.backupOutput)) {
    throw new Error('--backup-output must be an absolute path');
  }
  if (existsSync(args.backupOutput)) {
    throw new Error('--backup-output must not already exist');
  }
  if (!existsSync(dirname(args.backupOutput))) {
    throw new Error('backup output directory must already exist');
  }
  if (
    resolve(args.backupOutput)
      .toLowerCase()
      .startsWith(projectRoot.toLowerCase())
  ) {
    throw new Error('--backup-output must be outside backend2.0');
  }
}

async function ledger(client, migrationId) {
  const result = await client.query(
    `SELECT migration_id, script_checksum, status, backup_reference, details
       FROM app_schema_migrations WHERE migration_id = $1`,
    [migrationId],
  );
  return result.rows[0] ?? null;
}

function mappingShipmentIds(row) {
  const mapping = Array.isArray(row?.details?.mapping)
    ? row.details.mapping
    : [];
  return mapping.map(({ shipmentId }) => shipmentId);
}

async function tableCounts(client) {
  const result = await client.query(`SELECT
    (SELECT count(*)::int FROM booking_records) AS bookings,
    (SELECT count(*)::int FROM bill_of_lading_records) AS bills,
    (SELECT count(*)::int FROM arrival_notice_records) AS arrivals,
    (SELECT count(*)::int FROM delivery_order_records) AS delivery_orders`);
  return result.rows[0];
}

async function protectedRows(client, ids = null) {
  const bookings = await client.query(
    `SELECT to_jsonb(record) AS row FROM booking_records AS record
      ${ids ? 'WHERE id = ANY($1::bigint[])' : ''} ORDER BY id`,
    ids ? [ids.bookings] : [],
  );
  const bills = await client.query(
    `SELECT to_jsonb(record) AS row FROM bill_of_lading_records AS record
      ${ids ? 'WHERE id = ANY($1::bigint[])' : ''} ORDER BY id`,
    ids ? [ids.bills] : [],
  );
  const rows = {
    bookings: bookings.rows.map(({ row }) => row),
    bills: bills.rows.map(({ row }) => row),
  };
  return {
    ids: {
      bookings: rows.bookings.map(({ id }) => String(id)),
      bills: rows.bills.map(({ id }) => String(id)),
    },
    checksums: {
      bookings: checksumProtectedRows(rows.bookings),
      bills: checksumProtectedRows(rows.bills),
    },
    rows,
  };
}

async function verifyProtectedRows(client, before) {
  const current = await protectedRows(client, before.ids);
  if (
    current.rows.bookings.length !== before.rows.bookings.length ||
    current.rows.bills.length !== before.rows.bills.length ||
    current.checksums.bookings !== before.checksums.bookings ||
    current.checksums.bills !== before.checksums.bills
  ) {
    throw new Error('Previously migrated documents changed');
  }
  return current.checksums;
}

async function verifyMasterData(client, records) {
  const userIds = [
    ...new Set(records.map(({ createdByUserId }) => createdByUserId)),
  ];
  const partnerIds = [
    ...new Set(
      records
        .flatMap((record) => [
          record.bookingPayload.clientPartyId,
          record.blPayload.shipperPartyId,
          record.blPayload.consigneePartyId,
          record.blPayload.notifyPartyId,
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
    ORDER BY kind`);
  if (
    users.rows.length !== userIds.length ||
    users.rows.some(({ is_active: active }) => active !== true)
  ) {
    throw new Error('Referenced creator user is missing or inactive');
  }
  if (
    partners.rows.length !== partnerIds.length ||
    partners.rows.some(({ deleted_at: deletedAt }) => deletedAt != null)
  ) {
    throw new Error('Referenced partner is missing or archived');
  }
  if (
    catalogs.rows.length !== 2 ||
    catalogs.rows.some(({ service_type_id: serviceId }) => serviceId !== 2)
  ) {
    throw new Error('Freight Forwarding Type/Commodity identity is invalid');
  }
  return {
    userCount: users.rows.length,
    partnerCount: partners.rows.length,
    catalogs: catalogs.rows,
  };
}

async function verifyNoExisting(client, records) {
  const bookingNumbers = records.map(
    ({ bookingPayload }) => bookingPayload.bookingNumber,
  );
  const hblNumbers = records.map(({ blPayload }) => blPayload.fblNumber);
  const result = await client.query(
    `SELECT
      (SELECT count(*)::int FROM booking_records WHERE deleted_at IS NULL
        AND booking_number = ANY($1::text[])) AS bookings,
      (SELECT count(*)::int FROM bill_of_lading_records WHERE deleted_at IS NULL
        AND fbl_number = ANY($2::text[])) AS bills`,
    [bookingNumbers, hblNumbers],
  );
  if (result.rows[0].bookings !== 0 || result.rows[0].bills !== 0) {
    throw new Error(
      'One or more incremental Booking/HBL identities already exist',
    );
  }
  return result.rows[0];
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

async function verifyApplied(client, records) {
  const bookingNumbers = records.map(
    ({ bookingPayload }) => bookingPayload.bookingNumber,
  );
  const hblNumbers = records.map(({ blPayload }) => blPayload.fblNumber);
  const [bookingResult, billResult] = await Promise.all([
    client.query(
      `SELECT id::text, payload FROM booking_records WHERE deleted_at IS NULL
        AND booking_number = ANY($1::text[]) ORDER BY booking_number`,
      [bookingNumbers],
    ),
    client.query(
      `SELECT id::text, booking_id::text, payload
         FROM bill_of_lading_records WHERE deleted_at IS NULL
        AND fbl_number = ANY($1::text[]) ORDER BY fbl_number`,
      [hblNumbers],
    ),
  ]);
  if (
    bookingResult.rows.length !== records.length ||
    billResult.rows.length !== records.length
  ) {
    throw new Error('Incremental postflight count mismatch');
  }
  const bookingByNumber = new Map(
    bookingResult.rows.map((row) => [row.payload.bookingNumber, row]),
  );
  const billByNumber = new Map(
    billResult.rows.map((row) => [row.payload.fblNumber, row]),
  );
  let bookingGrossWeightFilled = 0;
  let containerGrossWeightFilled = 0;
  for (const record of records) {
    const booking = bookingByNumber.get(record.bookingPayload.bookingNumber);
    const bill = billByNumber.get(record.blPayload.fblNumber);
    if (!booking || !bill || bill.booking_id !== booking.id) {
      throw new Error(`${record.shipmentId}: Booking/BL relation mismatch`);
    }
    if (
      booking.payload.grossWeight !== record.bookingPayload.grossWeight ||
      booking.payload.clientPartyId !== record.bookingPayload.clientPartyId ||
      booking.payload.commodityTypeId !==
        record.bookingPayload.commodityTypeId ||
      booking.payload.commodityId !== record.bookingPayload.commodityId
    ) {
      throw new Error(`${record.shipmentId}: Booking payload mismatch`);
    }
    const actualContainers = bill.payload.containers;
    const expectedContainers = record.blPayload.containers;
    if (
      bill.payload.grossWeight !== record.blPayload.grossWeight ||
      !Array.isArray(actualContainers) ||
      actualContainers.length !== expectedContainers.length
    ) {
      throw new Error(`${record.shipmentId}: BL payload mismatch`);
    }
    for (let index = 0; index < expectedContainers.length; index += 1) {
      const actual = actualContainers[index];
      const expected = expectedContainers[index];
      if (
        actual.type !== expected.type ||
        actual.grossWeight !== expected.grossWeight ||
        actual.measurement !== expected.measurement ||
        actual.packageType !== expected.packageType
      ) {
        throw new Error(
          `${record.shipmentId}: container ${index + 1} mismatch`,
        );
      }
      if (String(actual.grossWeight ?? '').trim()) {
        containerGrossWeightFilled += 1;
      }
    }
    if (String(booking.payload.grossWeight ?? '').trim()) {
      bookingGrossWeightFilled += 1;
    }
  }
  return {
    bookings: bookingResult.rows.length,
    bills: billResult.rows.length,
    bookingGrossWeightFilled,
    containerGrossWeightFilled,
  };
}

async function main() {
  loadEnv(join(projectRoot, '.env'));
  loadEnv(join(projectRoot, '.env.local'));
  const args = parseArgs(process.argv.slice(2));
  const config = clientConfig();
  assertApplyGuards(args, config);
  const currentInput = JSON.parse(readFileSync(args.input, 'utf8'));
  const baselineInput = JSON.parse(readFileSync(args.baseline, 'utf8'));
  const records = selectNewlyReadyRecords(currentInput, baselineInput);
  const checksum = checksumIncrementalRecords(records);
  const client = new pg.Client(config);
  await client.connect();
  let lockAcquired = false;
  try {
    const firstLedger = await ledger(client, firstMigrationId);
    if (firstLedger?.status !== 'SUCCEEDED') {
      throw new Error('The first 139-record migration must be successful');
    }
    const validation = validateIncrementalRecords(
      records,
      mappingShipmentIds(firstLedger),
    );
    const currentLedger = await ledger(client, MIGRATION_ID);
    if (currentLedger?.status === 'SUCCEEDED') {
      if (currentLedger.script_checksum !== checksum) {
        throw new Error('Applied incremental input checksum changed');
      }
      const verified = await verifyApplied(client, records);
      const totals = await tableCounts(client);
      console.log(
        JSON.stringify({
          mode: 'postflight',
          alreadyApplied: true,
          database: config.database,
          checksum,
          verified,
          totals,
          mappingCount: Array.isArray(currentLedger.details?.mapping)
            ? currentLedger.details.mapping.length
            : 0,
        }),
      );
      return;
    }

    const inspect = async () => {
      const counts = await tableCounts(client);
      const master = await verifyMasterData(client, records);
      const noExisting = await verifyNoExisting(client, records);
      const protectedData = await protectedRows(client);
      return { counts, master, noExisting, protectedData };
    };

    if (!args.apply && !args.simulate) {
      await client.query(
        'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );
      try {
        const before = await inspect();
        await client.query('ROLLBACK');
        console.log(
          JSON.stringify({
            mode: 'dry-run',
            readOnly: true,
            database: config.database,
            checksum,
            validation,
            before: {
              counts: before.counts,
              master: before.master,
              noExisting: before.noExisting,
              protectedChecksums: before.protectedData.checksums,
            },
          }),
        );
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      return;
    }

    const lock = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [lockName],
    );
    lockAcquired = lock.rows[0]?.acquired === true;
    if (!lockAcquired)
      throw new Error('Incremental migration is already running');
    await client.query("SET lock_timeout = '5s'");
    await client.query("SET statement_timeout = '180s'");
    const before = await inspect();

    if (args.simulate) {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      try {
        await client.query(
          'LOCK TABLE booking_records, bill_of_lading_records IN SHARE ROW EXCLUSIVE MODE',
        );
        await verifyNoExisting(client, records);
        await verifyProtectedRows(client, before.protectedData);
        const mapping = await insertRecords(client, records);
        const verified = await verifyApplied(client, records);
        const protectedChecksums = await verifyProtectedRows(
          client,
          before.protectedData,
        );
        await client.query('ROLLBACK');
        console.log(
          JSON.stringify({
            mode: 'simulation',
            rolledBack: true,
            database: config.database,
            checksum,
            validation,
            mappingCount: mapping.length,
            verified,
            protectedChecksums,
          }),
        );
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      return;
    }

    const backup = {
      format: 'seatrans-legacy-ready-shipments-incremental-backup-v1',
      migrationId: MIGRATION_ID,
      createdAt: new Date().toISOString(),
      database: config.database,
      inputChecksum: checksum,
      validation,
      counts: before.counts,
      protected: before.protectedData,
    };
    const backupText = `${JSON.stringify(backup, null, 2)}\n`;
    writeFileSync(args.backupOutput, backupText, {
      encoding: 'utf8',
      flag: 'wx',
    });
    const backupChecksum = createHash('sha256')
      .update(backupText)
      .digest('hex');

    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
      await client.query(
        'LOCK TABLE booking_records, bill_of_lading_records IN SHARE ROW EXCLUSIVE MODE',
      );
      await verifyNoExisting(client, records);
      await verifyProtectedRows(client, before.protectedData);
      await client.query(
        `INSERT INTO app_schema_migrations
          (migration_id, script_checksum, status, backup_reference,
           logical_export_reference, details, started_at, completed_at)
         VALUES ($1, $2, 'RUNNING', $3, $3, $4::jsonb, NOW(), NULL)`,
        [
          MIGRATION_ID,
          checksum,
          args.backupOutput,
          JSON.stringify({
            readyCount: records.length,
            backupChecksum,
            protectedChecksums: before.protectedData.checksums,
          }),
        ],
      );
      const mapping = await insertRecords(client, records);
      const verified = await verifyApplied(client, records);
      const protectedChecksums = await verifyProtectedRows(
        client,
        before.protectedData,
      );
      await client.query(
        `UPDATE app_schema_migrations
          SET status = 'SUCCEEDED', completed_at = NOW(),
              details = details || $2::jsonb
          WHERE migration_id = $1`,
        [
          MIGRATION_ID,
          JSON.stringify({ mapping, verified, protectedChecksums }),
        ],
      );
      await client.query('COMMIT');
      console.log(
        JSON.stringify({
          committed: true,
          database: config.database,
          checksum,
          backup: args.backupOutput,
          backupChecksum,
          verified,
          mappingCount: mapping.length,
          protectedChecksums,
        }),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]);
    }
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
