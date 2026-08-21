import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  APPLY_CONFIRMATION,
  MIGRATION_ID,
  buildPlaceOfIssuePlan,
  checksumPlaceOfIssueEntries,
  extractPlaceOfIssueEntries,
} from './lib/freightek-place-of-issue-backfill.mjs';

const projectRoot = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const lockName = 'seatrans:freightek-place-of-issue:2026-08-21';

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

function sslConfig() {
  const enabled = ['true', '1', 'require', 'verify-ca', 'verify-full'].includes(
    process.env.DB_SSL?.trim().toLowerCase() ?? '',
  );
  if (!enabled) return undefined;
  return {
    rejectUnauthorized:
      process.env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() === 'true',
  };
}

function buildClientConfig() {
  const dbUrl = process.env.DB_URL?.trim();
  const ssl = sslConfig();
  if (dbUrl) {
    const parsed = new URL(dbUrl);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 5432,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ''),
      ssl,
      connectionTimeoutMillis: 15_000,
    };
  }
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'seatrans',
    ssl,
    connectionTimeoutMillis: 15_000,
  };
}

export function parseArgs(argv) {
  const result = {
    apply: false,
    input: null,
    targetDb: null,
    backupOutput: null,
    confirm: null,
  };
  for (const argument of argv) {
    if (argument === '--apply') result.apply = true;
    else if (argument === '--dry-run') continue;
    else {
      const [key, ...parts] = argument.split('=');
      const value = parts.join('=');
      if (key === '--input') result.input = value;
      else if (key === '--target-db') result.targetDb = value;
      else if (key === '--backup-output') result.backupOutput = value;
      else if (key === '--confirm') result.confirm = value;
      else throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!result.input || !isAbsolute(result.input) || !existsSync(result.input)) {
    throw new Error('--input must be an existing absolute JSON path');
  }
  return result;
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

async function selectDatabaseRows(client, bookingNumbers) {
  const result = await client.query(
    `SELECT
       b.id::text AS "bookingId",
       b.booking_number AS "bookingNumber",
       b.payload AS "bookingPayload",
       bl.id::text AS "billId",
       bl.fbl_number AS "fblNumber",
       bl.payload AS "billPayload"
     FROM booking_records b
     LEFT JOIN bill_of_lading_records bl
       ON bl.booking_id = b.id AND bl.deleted_at IS NULL
     WHERE b.deleted_at IS NULL
       AND b.booking_number = ANY($1::text[])
     ORDER BY b.booking_number, bl.id`,
    [bookingNumbers],
  );
  return result.rows;
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function protectedPayloadChecksum(rows) {
  const canonical = rows
    .map((row) => {
      const bookingPayload = { ...(row.bookingPayload ?? {}) };
      const billPayload = { ...(row.billPayload ?? {}) };
      delete bookingPayload.placeOfIssue;
      delete billPayload.placeOfIssue;
      return {
        bookingId: row.bookingId,
        billId: row.billId,
        bookingPayload,
        billPayload,
      };
    })
    .sort((left, right) => left.bookingId.localeCompare(right.bookingId));
  return stableHash(canonical);
}

async function getLedger(client) {
  const result = await client.query(
    `SELECT migration_id, script_checksum, status, details
       FROM app_schema_migrations
      WHERE migration_id = $1`,
    [MIGRATION_ID],
  );
  return result.rows[0] ?? null;
}

async function verifyApplied(client, updates, protectedChecksum) {
  const bookingNumbers = updates.map((update) => update.bookingNumber);
  const rows = await selectDatabaseRows(client, bookingNumbers);
  const byBooking = new Map(rows.map((row) => [row.bookingNumber, row]));
  const mismatches = [];
  for (const update of updates) {
    const row = byBooking.get(update.bookingNumber);
    if (
      row?.bookingPayload?.placeOfIssue !== update.placeOfIssue ||
      row?.billPayload?.placeOfIssue !== update.placeOfIssue
    ) {
      mismatches.push(update.bookingNumber);
    }
  }
  const afterProtectedChecksum = protectedPayloadChecksum(rows);
  if (mismatches.length > 0) {
    throw new Error(`Postflight value mismatch: ${mismatches.join(', ')}`);
  }
  if (afterProtectedChecksum !== protectedChecksum) {
    throw new Error('Postflight protected payload checksum changed');
  }
  return {
    verifiedCount: updates.length,
    protectedPayloadChecksum: afterProtectedChecksum,
  };
}

async function applyUpdates(client, updates) {
  const payload = JSON.stringify(updates);
  const bookingResult = await client.query(
    `UPDATE booking_records AS target
        SET payload = target.payload || jsonb_build_object('placeOfIssue', source."placeOfIssue"),
            updated_at = NOW()
       FROM jsonb_to_recordset($1::jsonb)
         AS source("bookingId" text, "placeOfIssue" text)
      WHERE target.id = source."bookingId"::bigint`,
    [payload],
  );
  const billResult = await client.query(
    `UPDATE bill_of_lading_records AS target
        SET payload = target.payload || jsonb_build_object('placeOfIssue', source."placeOfIssue"),
            updated_at = NOW()
       FROM jsonb_to_recordset($1::jsonb)
         AS source("billId" text, "placeOfIssue" text)
      WHERE target.id = source."billId"::bigint`,
    [payload],
  );
  if (
    bookingResult.rowCount !== updates.length ||
    billResult.rowCount !== updates.length
  ) {
    throw new Error(
      `Unexpected update counts: Booking=${bookingResult.rowCount}, BL=${billResult.rowCount}`,
    );
  }
}

async function main() {
  loadEnvFile(join(projectRoot, '.env'));
  loadEnvFile(join(projectRoot, '.env.local'));
  const args = parseArgs(process.argv.slice(2));
  const config = buildClientConfig();
  assertApplyGuards(args, config);
  const inputDocument = JSON.parse(readFileSync(args.input, 'utf8'));
  const sources = extractPlaceOfIssueEntries(inputDocument);
  const sourceChecksum = checksumPlaceOfIssueEntries(sources);
  const bookingNumbers = sources.map((source) => source.bookingNo);
  const client = new pg.Client(config);
  await client.connect();
  try {
    await client.query(
      args.apply
        ? 'BEGIN ISOLATION LEVEL SERIALIZABLE'
        : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    if (args.apply) {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '120s'");
      const lock = await client.query(
        'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired',
        [lockName],
      );
      if (lock.rows[0]?.acquired !== true) {
        throw new Error('Place-of-issue migration is already running');
      }
      await client.query(
        'LOCK TABLE booking_records, bill_of_lading_records IN SHARE ROW EXCLUSIVE MODE',
      );
    }

    const databaseRows = await selectDatabaseRows(client, bookingNumbers);
    const plan = buildPlaceOfIssuePlan(sources, databaseRows);
    if (plan.blockers.length > 0) {
      throw new Error(
        `Preflight has ${plan.blockers.length} blocker(s): ${JSON.stringify(plan.blockers)}`,
      );
    }
    const touchedRows = databaseRows.filter((row) =>
      plan.updates.some((update) => update.bookingId === row.bookingId),
    );
    const protectedChecksum = protectedPayloadChecksum(touchedRows);
    const ledger = await getLedger(client);
    if (ledger?.status === 'SUCCEEDED') {
      if (ledger.script_checksum !== sourceChecksum) {
        throw new Error('Applied migration checksum differs from this input');
      }
      const verified = await verifyApplied(
        client,
        plan.updates,
        protectedChecksum,
      );
      await client.query('ROLLBACK');
      console.log(
        JSON.stringify({
          mode: args.apply ? 'apply' : 'dry-run',
          alreadyApplied: true,
          sourceChecksum,
          inputCount: sources.length,
          nonblankCount: plan.updates.length,
          blankCount: plan.blankSourceCount,
          verified,
        }),
      );
      return;
    }
    if (ledger) {
      throw new Error(`Migration ledger is not reusable: ${ledger.status}`);
    }

    if (!args.apply) {
      await client.query('ROLLBACK');
      console.log(
        JSON.stringify({
          mode: 'dry-run',
          readOnly: true,
          targetDatabase: config.database,
          sourceChecksum,
          inputCount: sources.length,
          matchedCount: sources.length,
          updateCount: plan.updates.length,
          blankCount: plan.blankSourceCount,
          blockerCount: 0,
          protectedPayloadChecksum: protectedChecksum,
        }),
      );
      return;
    }

    const backup = {
      schemaVersion: 1,
      migrationId: MIGRATION_ID,
      createdAt: new Date().toISOString(),
      targetDatabase: config.database,
      sourcePath: resolve(args.input),
      sourceChecksum,
      protectedPayloadChecksum: protectedChecksum,
      updates: plan.updates,
      rows: touchedRows,
    };
    const backupText = `${JSON.stringify(backup, null, 2)}\n`;
    writeFileSync(args.backupOutput, backupText, {
      encoding: 'utf8',
      flag: 'wx',
    });
    const backupChecksum = createHash('sha256')
      .update(backupText)
      .digest('hex');

    await client.query(
      `INSERT INTO app_schema_migrations
        (migration_id, script_checksum, status, backup_reference,
         logical_export_reference, details, started_at, completed_at)
       VALUES ($1, $2, 'RUNNING', $3, $3, $4::jsonb, NOW(), NULL)`,
      [
        MIGRATION_ID,
        sourceChecksum,
        args.backupOutput,
        JSON.stringify({
          inputCount: sources.length,
          updateCount: plan.updates.length,
          blankCount: plan.blankSourceCount,
          backupChecksum,
          protectedPayloadChecksum: protectedChecksum,
        }),
      ],
    );
    await applyUpdates(client, plan.updates);
    const verified = await verifyApplied(
      client,
      plan.updates,
      protectedChecksum,
    );
    await client.query(
      `UPDATE app_schema_migrations
          SET status = 'SUCCEEDED', completed_at = NOW(),
              details = details || $2::jsonb
        WHERE migration_id = $1`,
      [MIGRATION_ID, JSON.stringify({ verified })],
    );
    await client.query('COMMIT');
    console.log(
      JSON.stringify({
        committed: true,
        targetDatabase: config.database,
        sourceChecksum,
        inputCount: sources.length,
        updatedBookings: plan.updates.length,
        updatedBills: plan.updates.length,
        blankSkipped: plan.blankSourceCount,
        backup: args.backupOutput,
        backupChecksum,
        verified,
      }),
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
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
