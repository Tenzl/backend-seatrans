import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

const root = resolve(import.meta.dirname, '..');
const applyConfirmation = 'APPLY_BOOKING_WORKFLOWS_20260803';
const purgeConfirmation = 'PURGE_HISTORY_AND_APPLY_BOOKING_WORKFLOWS_20260803';

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

function buildClientConfig() {
  const sslEnabled = [
    'true',
    '1',
    'require',
    'verify-ca',
    'verify-full',
  ].includes(process.env.DB_SSL?.trim().toLowerCase() ?? '');
  const ssl = sslEnabled
    ? {
        rejectUnauthorized:
          process.env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() ===
          'true',
      }
    : undefined;
  const dbUrl = process.env.DB_URL?.trim();
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

function parseArgs(argv) {
  const args = {
    apply: false,
    inspect: false,
    purgeHistory: false,
    targetDb: null,
    confirmation: null,
  };
  for (const argument of argv) {
    if (argument === '--apply') {
      args.apply = true;
      continue;
    }
    if (argument === '--inspect') {
      args.inspect = true;
      continue;
    }
    if (argument === '--purge-history') {
      args.purgeHistory = true;
      continue;
    }
    if (argument === '--dry-run') continue;
    const [key, ...parts] = argument.split('=');
    const value = parts.join('=');
    if (key === '--target-db') args.targetDb = value;
    else if (key === '--confirm') args.confirmation = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return args;
}

function assertApplyGuards(args, config) {
  if (args.inspect && args.apply) {
    throw new Error('--inspect and --apply cannot be used together');
  }
  if (args.purgeHistory && !args.apply) {
    throw new Error('--purge-history requires --apply');
  }
  if (!args.apply && !args.inspect) return;
  if (!args.targetDb || args.targetDb !== config.database) {
    throw new Error(
      '--target-db must exactly match the configured database name',
    );
  }
  if (args.inspect) return;
  const expectedConfirmation = args.purgeHistory
    ? purgeConfirmation
    : applyConfirmation;
  if (args.confirmation !== expectedConfirmation) {
    throw new Error(`--confirm must equal ${expectedConfirmation}`);
  }
}

loadEnv(join(root, '.env'));
loadEnv(join(root, '.env.local'));

const sqlFile = '2026-08-03_booking_workflows.sql';
const purgeSqlFile = '2026-08-03_purge_booking_document_history.sql';
const config = buildClientConfig();
const args = parseArgs(process.argv.slice(2));
assertApplyGuards(args, config);

async function main() {
  console.log(
    JSON.stringify({
      mode: args.apply ? 'apply' : args.inspect ? 'inspect' : 'dry-run',
      migration: sqlFile,
      database: config.database,
      purgeHistory: args.purgeHistory,
    }),
  );
  if (!args.apply && !args.inspect) {
    console.log('Dry-run only. No database changes were written.');
    return;
  }

  const client = new pg.Client(config);
  await client.connect();
  try {
    const databaseCheck = await client.query(`
      SELECT
        current_database() AS database,
        to_regclass('public.booking_document_records') IS NOT NULL AS has_table,
        to_regclass('public.booking_records') IS NOT NULL AS has_split_schema
    `);
    const databaseState = databaseCheck.rows[0];
    if (databaseState?.database !== args.targetDb) {
      throw new Error('Connected database does not match --target-db');
    }
    if (databaseState?.has_split_schema === true) {
      throw new Error(
        'apply-booking-workflows.mjs is obsolete after the four-table split',
      );
    }
    if (databaseState?.has_table !== true) {
      throw new Error('booking_document_records table does not exist');
    }
    if (args.apply) await client.query('BEGIN');
    const before = await client.query(
      'SELECT COUNT(*)::integer AS record_count FROM booking_document_records',
    );
    if (args.inspect) {
      console.log(
        JSON.stringify({
          ok: true,
          database: databaseState.database,
          recordCount: before.rows[0]?.record_count ?? 0,
          readOnly: true,
        }),
      );
      return;
    }

    if (args.purgeHistory) {
      await client.query(
        readFileSync(join(root, 'scripts', 'migrations', purgeSqlFile), 'utf8'),
      );
    }
    await client.query(
      readFileSync(join(root, 'scripts', 'migrations', sqlFile), 'utf8'),
    );

    const check = await client.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'booking_document_records'
          AND column_name = 'booking_flow'
      ) AS has_booking_flow,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'booking_document_records'
          AND column_name = 'booking_id'
      ) AS has_booking_id
    `);
    if (
      check.rows[0]?.has_booking_flow !== true ||
      check.rows[0]?.has_booking_id !== true
    ) {
      throw new Error('Booking workflow migration validation failed');
    }
    const after = await client.query(
      'SELECT COUNT(*)::integer AS record_count FROM booking_document_records',
    );
    await client.query('COMMIT');
    console.log(
      JSON.stringify({
        ok: true,
        migration: sqlFile,
        purgedRecords: args.purgeHistory
          ? (before.rows[0]?.record_count ?? 0)
          : 0,
        remainingRecords: after.rows[0]?.record_count ?? 0,
        ...check.rows[0],
      }),
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
