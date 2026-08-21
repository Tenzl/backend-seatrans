import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  APPLY_CONFIRMATION,
  MIGRATION_ID,
  SOURCE_MIGRATION_ID,
  buildBillGrossWeightCorrection,
  checksumCorrectionTargets,
} from './lib/legacy-ready-bl-gross-weight-fix.mjs';

const projectRoot = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const lockName = 'seatrans:legacy-ready-bl-gross-weight-fix:2026-08-20';
const expectedTargetCount = 139;

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
      if (key === '--target-db') args.targetDb = value;
      else if (key === '--confirm') args.confirm = value;
      else if (key === '--backup-output') args.backupOutput = value;
      else throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return args;
}

function assertApplyGuards(args, config) {
  if (!args.apply) return;
  if (args.targetDb !== config.database) {
    throw new Error('--target-db must exactly match the configured database');
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
  if (
    resolve(args.backupOutput)
      .toLowerCase()
      .startsWith(projectRoot.toLowerCase())
  ) {
    throw new Error('--backup-output must be outside backend2.0');
  }
}

async function getLedger(client, migrationId) {
  const result = await client.query(
    `SELECT migration_id, script_checksum, status, details
       FROM app_schema_migrations
      WHERE migration_id = $1`,
    [migrationId],
  );
  return result.rows[0] ?? null;
}

function sourceMapping(ledger) {
  if (ledger?.status !== 'SUCCEEDED') {
    throw new Error(`${SOURCE_MIGRATION_ID} must be SUCCEEDED first`);
  }
  const mapping = ledger.details?.mapping;
  if (!Array.isArray(mapping) || mapping.length !== expectedTargetCount) {
    throw new Error(
      `Source migration must contain exactly ${expectedTargetCount} mappings`,
    );
  }
  return mapping;
}

async function loadTargets(client, mapping, lockRows = false) {
  const billIds = mapping.map((entry) => String(entry.billOfLadingId));
  const result = await client.query(
    `SELECT
       b.id::text AS booking_id,
       b.payload AS booking_payload,
       bl.id::text AS bill_of_lading_id,
       bl.booking_id::text AS linked_booking_id,
       bl.payload AS bl_payload
     FROM bill_of_lading_records bl
     JOIN booking_records b ON b.id = bl.booking_id
     WHERE bl.id = ANY($1::bigint[])
       AND bl.deleted_at IS NULL
       AND b.deleted_at IS NULL
     ORDER BY bl.id
     ${lockRows ? 'FOR UPDATE OF bl' : ''}`,
    [billIds],
  );
  if (result.rows.length !== mapping.length) {
    throw new Error('One or more migrated Booking/BL rows are missing');
  }

  const byBillId = new Map(
    result.rows.map((row) => [row.bill_of_lading_id, row]),
  );
  return mapping.map((entry) => {
    const row = byBillId.get(String(entry.billOfLadingId));
    if (
      !row ||
      row.booking_id !== String(entry.bookingId) ||
      row.linked_booking_id !== String(entry.bookingId)
    ) {
      throw new Error(`${entry.shipmentId}: Booking/BL mapping mismatch`);
    }
    return {
      shipmentId: entry.shipmentId,
      bookingId: row.booking_id,
      billOfLadingId: row.bill_of_lading_id,
      bookingPayload: row.booking_payload,
      blPayload: row.bl_payload,
    };
  });
}

function correctionPlan(targets) {
  const entries = targets.map((target) => ({
    ...target,
    correction: buildBillGrossWeightCorrection(target),
  }));
  return {
    targetCount: entries.length,
    changedCount: entries.filter((entry) => entry.correction.changed).length,
    unchangedCount: entries.filter((entry) => !entry.correction.changed).length,
    entries,
  };
}

function backupDocument(config, targets, checksum) {
  return {
    migrationId: MIGRATION_ID,
    sourceMigrationId: SOURCE_MIGRATION_ID,
    database: config.database,
    createdAt: new Date().toISOString(),
    targetChecksum: checksum,
    rows: targets.map((target) => ({
      shipmentId: target.shipmentId,
      bookingId: target.bookingId,
      billOfLadingId: target.billOfLadingId,
      bookingPayload: target.bookingPayload,
      blPayload: target.blPayload,
    })),
  };
}

function verifyCorrected(targets) {
  for (const target of targets) {
    const containers = target.blPayload?.containers;
    if (
      !Array.isArray(containers) ||
      containers.some((container) =>
        String(container?.grossWeight ?? '').trim(),
      ) ||
      String(target.blPayload?.grossWeight ?? '').trim()
    ) {
      throw new Error(`${target.shipmentId}: BL gross weight is not corrected`);
    }
  }
  return {
    targetCount: targets.length,
    bookingGrossWeightsPreserved: targets.filter((target) =>
      String(target.bookingPayload?.grossWeight ?? '').trim(),
    ).length,
    blankBillGrossWeights: targets.length,
  };
}

async function main() {
  loadEnvFile(join(projectRoot, '.env'));
  loadEnvFile(join(projectRoot, '.env.local'));
  const args = parseArgs(process.argv.slice(2));
  const config = buildClientConfig();
  assertApplyGuards(args, config);
  const client = new pg.Client(config);
  await client.connect();
  let lockAcquired = false;
  try {
    const sourceLedger = await getLedger(client, SOURCE_MIGRATION_ID);
    const mapping = sourceMapping(sourceLedger);
    const existingLedger = await getLedger(client, MIGRATION_ID);
    if (existingLedger?.status === 'SUCCEEDED') {
      const targets = await loadTargets(client, mapping);
      console.log(
        JSON.stringify({
          mode: args.apply ? 'apply' : 'dry-run',
          alreadyApplied: true,
          verified: verifyCorrected(targets),
        }),
      );
      return;
    }

    if (!args.apply) {
      await client.query('BEGIN TRANSACTION READ ONLY');
      try {
        const targets = await loadTargets(client, mapping);
        const plan = correctionPlan(targets);
        const checksum = checksumCorrectionTargets(targets);
        await client.query('ROLLBACK');
        console.log(
          JSON.stringify({
            mode: 'dry-run',
            readOnly: true,
            database: config.database,
            checksum,
            targetCount: plan.targetCount,
            changedCount: plan.changedCount,
            unchangedCount: plan.unchangedCount,
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
    if (!lockAcquired) throw new Error('Gross-weight fix is already running');
    await client.query("SET lock_timeout = '5s'");
    await client.query("SET statement_timeout = '120s'");

    const beforeTargets = await loadTargets(client, mapping);
    const beforePlan = correctionPlan(beforeTargets);
    const beforeChecksum = checksumCorrectionTargets(beforeTargets);
    const backupText = `${JSON.stringify(
      backupDocument(config, beforeTargets, beforeChecksum),
      null,
      2,
    )}\n`;
    writeFileSync(args.backupOutput, backupText, 'utf8');
    const backupChecksum = createHash('sha256')
      .update(backupText)
      .digest('hex');

    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
      const lockedTargets = await loadTargets(client, mapping, true);
      const lockedChecksum = checksumCorrectionTargets(lockedTargets);
      if (lockedChecksum !== beforeChecksum) {
        throw new Error('Target BL rows changed after backup');
      }
      const plan = correctionPlan(lockedTargets);
      await client.query(
        `INSERT INTO app_schema_migrations
          (migration_id, script_checksum, status, backup_reference,
           logical_export_reference, details, started_at, completed_at)
         VALUES ($1, $2, 'RUNNING', $3, $3, $4::jsonb, NOW(), NULL)`,
        [
          MIGRATION_ID,
          beforeChecksum,
          args.backupOutput,
          JSON.stringify({
            sourceMigrationId: SOURCE_MIGRATION_ID,
            targetCount: plan.targetCount,
            changedCount: plan.changedCount,
            backupChecksum,
          }),
        ],
      );
      for (const entry of plan.entries) {
        if (!entry.correction.changed) continue;
        await client.query(
          'UPDATE bill_of_lading_records SET payload = $1::jsonb WHERE id = $2::bigint',
          [JSON.stringify(entry.correction.payload), entry.billOfLadingId],
        );
      }
      const correctedTargets = await loadTargets(client, mapping, true);
      const verified = verifyCorrected(correctedTargets);
      await client.query(
        `UPDATE app_schema_migrations
            SET status = 'SUCCEEDED', completed_at = NOW(),
                details = details || $2::jsonb
          WHERE migration_id = $1`,
        [MIGRATION_ID, JSON.stringify({ verified })],
      );
      await client.query('COMMIT');

      const verifiedTargets = await loadTargets(client, mapping);
      console.log(
        JSON.stringify({
          committed: true,
          database: config.database,
          beforeChecksum,
          backup: args.backupOutput,
          backupChecksum,
          changedCount: beforePlan.changedCount,
          verified: verifyCorrected(verifiedTargets),
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
