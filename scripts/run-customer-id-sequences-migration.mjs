import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  validateCustomerIdSequencePostflight,
  validateCustomerIdSequencePreflight,
} from './lib/customer-id-sequence-migration-support.mjs';

const PROJECT_ROOT = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-07-30_customer_id_sequences_expand.sql',
);
const MIGRATION_ID = '2026-07-30_customer_id_sequences_expand_v1';
const CONFIRMATION = 'APPLY_CUSTOMER_ID_SEQUENCES_20260730';
const LOCK_NAME = 'seatrans:customer-id-sequences:2026-07-30';

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

function parseArgs(argv) {
  const result = {
    apply: false,
    targetDb: null,
    backupReference: null,
    logicalExport: null,
    confirmation: null,
  };
  for (const argument of argv) {
    if (argument === '--apply') {
      result.apply = true;
      continue;
    }
    if (argument === '--dry-run') continue;
    const [key, ...parts] = argument.split('=');
    const value = parts.join('=');
    if (key === '--target-db') result.targetDb = value;
    else if (key === '--backup-reference') result.backupReference = value;
    else if (key === '--logical-export') result.logicalExport = value;
    else if (key === '--confirm') result.confirmation = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function buildSsl() {
  const explicit = process.env.DB_SSL?.trim().toLowerCase();
  if (
    !['true', '1', 'require', 'verify-ca', 'verify-full'].includes(
      explicit ?? '',
    )
  ) {
    return undefined;
  }
  return {
    rejectUnauthorized:
      process.env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() === 'true',
  };
}

function buildClientConfig() {
  const dbUrl = process.env.DB_URL?.trim();
  const ssl = buildSsl();
  if (dbUrl) {
    const parsed = new URL(dbUrl);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 5432,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ''),
      ssl,
    };
  }
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'seatrans',
    ssl,
  };
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function verifyApplyGuards(args, config) {
  if (!args.apply) return null;
  if (!args.targetDb || args.targetDb !== config.database) {
    throw new Error(
      '--target-db must exactly match the configured database name',
    );
  }
  if (!args.backupReference?.trim()) {
    throw new Error('--backup-reference is required for --apply');
  }
  if (args.confirmation !== CONFIRMATION) {
    throw new Error(`--confirm must equal ${CONFIRMATION}`);
  }
  if (!args.logicalExport || !isAbsolute(args.logicalExport)) {
    throw new Error('--logical-export must be an absolute existing file');
  }

  const path = realpathSync(args.logicalExport);
  const stats = statSync(path);
  if (!stats.isFile() || stats.size === 0) {
    throw new Error('--logical-export must be a non-empty file');
  }
  const projectRelative = relative(PROJECT_ROOT, path);
  if (
    projectRelative === '' ||
    (!projectRelative.startsWith('..') && !isAbsolute(projectRelative))
  ) {
    throw new Error('--logical-export must be stored outside backend2.0');
  }
  return { path, size: stats.size, checksum: hashFile(path) };
}

function maskHost(host) {
  if (host === 'localhost' || host === '127.0.0.1') return host;
  if (!host) return '(empty)';
  return host.length < 5
    ? `${host[0]}***`
    : `${host.slice(0, 2)}***${host.slice(-2)}`;
}

async function inspectSchema(client, expectedChecksum) {
  const tableResult = await client.query(
    `SELECT to_regclass('public.customer_id_sequences') IS NOT NULL AS exists`,
  );
  const tableExists = tableResult.rows[0]?.exists === true;
  let columns = [];
  let constraints = [];
  let invalidRows = [];
  let duplicateDates = [];
  let rowCount = 0;
  let rowChecksum = createHash('sha256').update('[]').digest('hex');

  if (tableExists) {
    // A pg Client uses one socket; keep inspection queries sequential.
    const columnResult = await client.query(
      `SELECT column_name AS name, data_type AS "dataType",
                  character_maximum_length::integer AS length,
                  is_nullable AS nullable, column_default AS "default"
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'customer_id_sequences'
            ORDER BY ordinal_position`,
    );
    const constraintResult = await client.query(
      `SELECT conname AS name, contype AS type, convalidated AS validated,
                  pg_get_constraintdef(oid) AS definition
             FROM pg_constraint
            WHERE conrelid = 'public.customer_id_sequences'::regclass
            ORDER BY conname`,
    );
    const invalidResult = await client.query(
      `SELECT btrim(sequence_date) AS sequence_date
             FROM customer_id_sequences
            WHERE btrim(sequence_date) !~ '^[0-9]{6}$'
               OR current_value < 0
            ORDER BY sequence_date
            LIMIT 100`,
    );
    const duplicateResult = await client.query(
      `SELECT btrim(sequence_date) AS sequence_date
             FROM customer_id_sequences
            GROUP BY btrim(sequence_date)
           HAVING count(*) > 1
            ORDER BY sequence_date
            LIMIT 100`,
    );
    columns = columnResult.rows;
    constraints = constraintResult.rows;
    invalidRows = invalidResult.rows.map((row) => row.sequence_date);
    duplicateDates = duplicateResult.rows.map((row) => row.sequence_date);
    const rows = await client.query(
      `SELECT btrim(sequence_date) AS sequence_date,
              current_value::text AS current_value
         FROM customer_id_sequences
        ORDER BY sequence_date`,
    );
    rowCount = rows.rowCount ?? 0;
    rowChecksum = createHash('sha256')
      .update(JSON.stringify(rows.rows))
      .digest('hex');
  }

  const expectedNames = new Set(['sequence_date', 'current_value']);
  const constraintByName = new Map(
    constraints.map((constraint) => [constraint.name, constraint]),
  );
  const primaryKeyCovered = constraints.some(
    (constraint) =>
      constraint.type === 'p' &&
      /^\s*PRIMARY KEY\s+\(sequence_date\)\s*$/i.test(constraint.definition),
  );
  const dateConstraint = constraintByName.get('ck_customer_id_sequences_date');
  const valueConstraint = constraintByName.get(
    'ck_customer_id_sequences_value_nonnegative',
  );
  const constraintConflicts = [];
  if (
    constraints.some((constraint) => constraint.type === 'p') &&
    !primaryKeyCovered
  ) {
    constraintConflicts.push('primary_key');
  }
  if (
    dateConstraint &&
    !/btrim.*sequence_date.*~.*\^\[0-9\]\{6\}\$/i.test(
      dateConstraint.definition,
    )
  ) {
    constraintConflicts.push('ck_customer_id_sequences_date');
  }
  if (
    valueConstraint &&
    !/current_value\s*>=\s*0/i.test(valueConstraint.definition)
  ) {
    constraintConflicts.push('ck_customer_id_sequences_value_nonnegative');
  }

  const ledgerTable = await client.query(
    `SELECT to_regclass('public.app_schema_migrations') IS NOT NULL AS exists`,
  );
  let ledger = null;
  if (ledgerTable.rows[0]?.exists === true) {
    const result = await client.query(
      `SELECT migration_id, script_checksum, status
         FROM app_schema_migrations
        WHERE migration_id = $1`,
      [MIGRATION_ID],
    );
    ledger = result.rows[0] ?? null;
  }

  return {
    tableExists,
    columns,
    unexpectedColumns: columns
      .map((column) => column.name)
      .filter((name) => !expectedNames.has(name)),
    constraints,
    constraintConflicts,
    primaryKeyCovered,
    dateConstraintCovered:
      dateConstraint?.validated === true && constraintConflicts.length === 0,
    valueConstraintCovered:
      valueConstraint?.validated === true && constraintConflicts.length === 0,
    invalidRows,
    duplicateDates,
    rowCount,
    rowChecksum,
    ledger: {
      tableExists: ledgerTable.rows[0]?.exists === true,
      entry: ledger,
      checksumMatches:
        ledger == null || ledger.script_checksum === expectedChecksum,
    },
  };
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      migration_id VARCHAR(160) PRIMARY KEY,
      script_checksum CHAR(64) NOT NULL,
      status VARCHAR(16) NOT NULL
        CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
      backup_reference TEXT,
      logical_export_reference TEXT,
      details JSONB,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);
}

async function inspectReadOnly(client, checksum) {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    await client.query(`SET LOCAL statement_timeout = '30s'`);
    const report = await inspectSchema(client, checksum);
    await client.query('ROLLBACK');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  loadEnvFile(join(PROJECT_ROOT, '.env.local'));
  const args = parseArgs(process.argv.slice(2));
  const config = buildClientConfig();
  const sql = readFileSync(SQL_PATH, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const logicalExport = verifyApplyGuards(args, config);

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? 'apply' : 'dry-run',
        migrationId: MIGRATION_ID,
        scriptChecksum: checksum,
        target: {
          host: maskHost(config.host),
          port: config.port,
          database: config.database,
        },
      },
      null,
      2,
    ),
  );

  const client = new pg.Client(config);
  await client.connect();
  let lockAcquired = false;
  try {
    if (!args.apply) {
      const report = await inspectReadOnly(client, checksum);
      validateCustomerIdSequencePreflight(report);
      console.log(JSON.stringify({ preflight: report }, null, 2));
      console.log(
        'Dry-run only. A READ ONLY transaction was used; no schema or ledger changes were written.',
      );
      return;
    }

    const lockResult = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [LOCK_NAME],
    );
    lockAcquired = lockResult.rows[0]?.acquired === true;
    if (!lockAcquired) {
      throw new Error(
        'Another customer id sequence migration is already running',
      );
    }
    await client.query(`SET lock_timeout = '5s'`);
    await client.query(`SET statement_timeout = '5min'`);
    await client.query(`SET idle_in_transaction_session_timeout = '60s'`);

    const before = await inspectReadOnly(client, checksum);
    validateCustomerIdSequencePreflight(before);
    if (!before.ledger.checksumMatches) {
      throw new Error(
        'Migration ID already exists with a different script checksum',
      );
    }
    if (before.ledger.entry?.status === 'SUCCEEDED') {
      validateCustomerIdSequencePostflight(before, before);
      console.log('Migration already succeeded with the same checksum.');
      return;
    }

    await ensureLedger(client);
    await client.query(
      `INSERT INTO app_schema_migrations (
         migration_id, script_checksum, status, backup_reference,
         logical_export_reference, started_at, completed_at, details
       )
       VALUES ($1, $2, 'RUNNING', $3, $4, NOW(), NULL, $5::jsonb)
       ON CONFLICT (migration_id) DO UPDATE SET
         status = 'RUNNING',
         backup_reference = EXCLUDED.backup_reference,
         logical_export_reference = EXCLUDED.logical_export_reference,
         started_at = NOW(),
         completed_at = NULL,
         details = EXCLUDED.details`,
      [
        MIGRATION_ID,
        checksum,
        args.backupReference,
        logicalExport.path,
        JSON.stringify({ before, logicalExport }),
      ],
    );

    try {
      await client.query('BEGIN');
      await client.query(sql);
      const after = await inspectSchema(client, checksum);
      validateCustomerIdSequencePostflight(before, after);
      await client.query('COMMIT');
      await client.query(
        `UPDATE app_schema_migrations
            SET status = 'SUCCEEDED', completed_at = NOW(),
                details = $2::jsonb
          WHERE migration_id = $1`,
        [MIGRATION_ID, JSON.stringify({ before, after, logicalExport })],
      );
      console.log(
        JSON.stringify({ committed: true, validation: after }, null, 2),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      await client.query(
        `UPDATE app_schema_migrations
            SET status = 'FAILED', completed_at = NOW(),
                details = details || jsonb_build_object('error', $2::text)
          WHERE migration_id = $1`,
        [MIGRATION_ID, error instanceof Error ? error.message : String(error)],
      );
      throw error;
    }
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
        LOCK_NAME,
      ]);
    }
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
