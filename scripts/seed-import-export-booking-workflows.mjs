import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

const root = resolve(import.meta.dirname, '..');
const applyConfirmation = 'SEED_IMPORT_EXPORT_BOOKING_WORKFLOWS_20260804';
const sqlFile = '2026-08-04_seed_import_export_booking_workflows.sql';

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
  if (!args.apply && !args.inspect) return;
  if (!args.targetDb || args.targetDb !== config.database) {
    throw new Error(
      '--target-db must exactly match the configured database name',
    );
  }
  if (args.inspect) return;
  if (args.confirmation !== applyConfirmation) {
    throw new Error(`--confirm must equal ${applyConfirmation}`);
  }
}

loadEnv(join(root, '.env'));
loadEnv(join(root, '.env.local'));

const config = buildClientConfig();
const args = parseArgs(process.argv.slice(2));
assertApplyGuards(args, config);

async function listSampleRows(client) {
  const result = await client.query(`
    SELECT
      id,
      document_type,
      booking_flow,
      booking_id,
      reference_number,
      status
    FROM booking_document_records
    WHERE deleted_at IS NULL
      AND (
        reference_number LIKE 'SAMPLE-EXP-%'
        OR reference_number LIKE 'SAMPLE-IMP-%'
        OR booking_id IN (
          SELECT id FROM booking_document_records
          WHERE reference_number IN ('SAMPLE-EXP-BK', 'SAMPLE-IMP-BK')
            AND deleted_at IS NULL
        )
      )
    ORDER BY
      CASE
        WHEN reference_number LIKE 'SAMPLE-EXP-%' THEN 0
        WHEN reference_number LIKE 'SAMPLE-IMP-%' THEN 1
        ELSE 2
      END,
      id ASC
  `);
  return result.rows;
}

async function main() {
  console.log(
    JSON.stringify({
      mode: args.apply ? 'apply' : args.inspect ? 'inspect' : 'dry-run',
      seed: sqlFile,
      database: config.database,
    }),
  );
  if (!args.apply && !args.inspect) {
    console.log(
      [
        'Dry-run only. No database changes were written.',
        'Inspect: node scripts/seed-import-export-booking-workflows.mjs --inspect --target-db=<db>',
        `Apply:   node scripts/seed-import-export-booking-workflows.mjs --apply --target-db=<db> --confirm=${applyConfirmation}`,
      ].join('\n'),
    );
    return;
  }

  const client = new pg.Client(config);
  await client.connect();
  try {
    const databaseCheck = await client.query(`
      SELECT
        current_database() AS database,
        to_regclass('public.booking_document_records') IS NOT NULL AS has_table,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'booking_document_records'
            AND column_name = 'booking_flow'
        ) AS has_booking_flow
    `);
    const databaseState = databaseCheck.rows[0];
    if (databaseState?.database !== args.targetDb) {
      throw new Error('Connected database does not match --target-db');
    }
    if (databaseState?.has_table !== true) {
      throw new Error('booking_document_records table does not exist');
    }
    if (databaseState?.has_booking_flow !== true) {
      throw new Error(
        'booking_flow column missing — run apply-booking-workflows.mjs first',
      );
    }

    if (args.inspect) {
      console.log(
        JSON.stringify(
          { ok: true, database: databaseState.database, samples: await listSampleRows(client) },
          null,
          2,
        ),
      );
      return;
    }

    await client.query(
      readFileSync(join(root, 'scripts', 'migrations', sqlFile), 'utf8'),
    );
    const samples = await listSampleRows(client);
    console.log(
      JSON.stringify(
        {
          ok: true,
          seed: sqlFile,
          database: databaseState.database,
          sampleCount: samples.length,
          samples,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
