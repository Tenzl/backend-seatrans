import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import pg from 'pg';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const PG_RESTORE = 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_restore.exe';
const DATABASE_PREFIX = 'codex_booking_rel_verify_';
const PHASE_CONFIRMATIONS = {
  expand: 'APPLY_BOOKING_RELATIONAL_EXPAND_20260821',
  data: 'APPLY_BOOKING_RELATIONAL_DATA_20260821',
  validate: 'APPLY_BOOKING_RELATIONAL_VALIDATE_20260821',
  report: 'APPLY_BOOKING_REPORT_VIEW_20260821',
};

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    const separator = value.indexOf('=');
    if (separator < 1) continue;
    const key = value.slice(0, separator).trim();
    let content = value.slice(separator + 1).trim();
    if (
      (content.startsWith('"') && content.endsWith('"')) ||
      (content.startsWith("'") && content.endsWith("'"))
    ) {
      content = content.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = content;
  }
}

function requireDump(argv) {
  const value = argv
    .find((item) => item.startsWith('--pg-dump='))
    ?.slice('--pg-dump='.length);
  if (!value || !isAbsolute(value) || !existsSync(value) || statSync(value).size === 0) {
    throw new Error('--pg-dump must be an existing, non-empty absolute custom-format dump');
  }
  return value;
}

function connectionConfig(database) {
  const url = process.env.DB_URL?.trim();
  const ssl = ['true', '1', 'require', 'verify-ca', 'verify-full'].includes(
    process.env.DB_SSL?.toLowerCase() ?? '',
  )
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' }
    : undefined;
  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 5432,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: database ?? parsed.pathname.replace(/^\/+/, ''),
      ssl,
      sourceUrl: parsed,
    };
  }
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: database ?? process.env.DB_DATABASE ?? 'seatrans',
    ssl,
    sourceUrl: null,
  };
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: 'inherit',
      windowsHide: true,
      ...options,
    });
    child.once('error', rejectPromise);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}

function runnerEnvironment(config, database) {
  const env = { ...process.env };
  if (config.sourceUrl) {
    const targetUrl = new URL(config.sourceUrl.toString());
    targetUrl.pathname = `/${database}`;
    env.DB_URL = targetUrl.toString();
  } else {
    delete env.DB_URL;
    env.DB_DATABASE = database;
  }
  return env;
}

async function validate(database, config) {
  const client = new pg.Client({ ...config, database });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM public.booking_records) AS bookings,
        (SELECT COUNT(*)::int FROM public.bill_of_lading_records) AS bills,
        (SELECT COUNT(*)::int FROM public.arrival_notice_records) AS notices,
        (SELECT COUNT(*)::int FROM public.delivery_order_records) AS delivery_orders,
        (SELECT COALESCE(SUM(quantity), 0)::int FROM public.booking_cargo_volumes) AS planned_quantity,
        (SELECT COUNT(*)::int FROM public.bill_of_lading_containers) AS bill_containers,
        (SELECT COUNT(*)::int FROM public.booking_reporting_v1) AS report_rows,
        (SELECT COUNT(*)::int FROM public.booking_records WHERE payload IS NULL) AS missing_booking_payloads,
        (SELECT COUNT(*)::int FROM public.bill_of_lading_records WHERE payload IS NULL) AS missing_bill_payloads,
        (SELECT COUNT(*)::int FROM public.bill_of_lading_containers container
          WHERE COALESCE(NULLIF(BTRIM(container.container_type_code), ''),
                         NULLIF(BTRIM(container.container_no), ''),
                         NULLIF(BTRIM(container.seal_no), ''),
                         NULLIF(BTRIM(container.gross_weight_raw), ''),
                         NULLIF(BTRIM(container.measurement_raw), ''),
                         NULLIF(BTRIM(container.tare_raw), ''),
                         NULLIF(BTRIM(container.package_type_snapshot), ''),
                         NULLIF(BTRIM(container.number_of_packages_raw), ''),
                         NULLIF(BTRIM(container.method), ''),
                         NULLIF(BTRIM(container.presentation_payload->>'note'), '')) IS NULL
        ) AS blank_bill_containers
    `);
    const actual = result.rows[0];
    const expected = {
      bookings: 311,
      bills: 310,
      notices: 0,
      delivery_orders: 0,
      planned_quantity: 408,
      bill_containers: 407,
      report_rows: 311,
      missing_booking_payloads: 0,
      missing_bill_payloads: 0,
      blank_bill_containers: 0,
    };
    for (const [key, expectedValue] of Object.entries(expected)) {
      if (Number(actual[key]) !== expectedValue) {
        throw new Error(`Restore verification failed: ${key}=${actual[key]}, expected ${expectedValue}`);
      }
    }
    console.log(JSON.stringify({ status: 'PASS', temporaryDatabase: database, controls: actual }, null, 2));
  } finally {
    await client.end();
  }
}

async function main() {
  loadEnv(join(ROOT, '.env'));
  loadEnv(join(ROOT, '.env.local'));
  const dump = requireDump(process.argv.slice(2));
  if (!existsSync(PG_RESTORE)) throw new Error(`pg_restore not found at ${PG_RESTORE}`);

  const source = connectionConfig();
  const temporaryDatabase = `${DATABASE_PREFIX}${randomBytes(5).toString('hex')}`;
  if (!temporaryDatabase.startsWith(DATABASE_PREFIX)) throw new Error('Unsafe temporary database name');

  const admin = new pg.Client(source);
  await admin.connect();
  let created = false;
  try {
    await admin.query(`CREATE DATABASE ${temporaryDatabase}`);
    created = true;
    const temporary = new pg.Client({ ...source, database: temporaryDatabase });
    await temporary.connect();
    try {
      await temporary.query('DROP SCHEMA public CASCADE');
    } finally {
      await temporary.end();
    }

    const restore = (section) =>
      run(
        PG_RESTORE,
        [
        '--host', source.host,
        '--port', String(source.port),
        '--username', source.user,
        '--dbname', temporaryDatabase,
        '--no-owner',
        '--no-privileges',
        '--exit-on-error',
        `--section=${section}`,
        dump,
        ],
        { env: { ...process.env, PGPASSWORD: source.password } },
      );

    await restore('pre-data');
    const extensionClient = new pg.Client({ ...source, database: temporaryDatabase });
    await extensionClient.connect();
    try {
      await extensionClient.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    } finally {
      await extensionClient.end();
    }
    await restore('data');
    await restore('post-data');

    const env = runnerEnvironment(source, temporaryDatabase);
    for (const [phase, confirmation] of Object.entries(PHASE_CONFIRMATIONS)) {
      await run(process.execPath, [
        'scripts/run-booking-documents-relational-migration.mjs',
        '--apply',
        `--phase=${phase}`,
        `--target-db=${temporaryDatabase}`,
        `--confirm=${confirmation}`,
        `--pg-dump=${dump}`,
      ], { env });
    }
    await validate(temporaryDatabase, source);
  } finally {
    if (created) {
      await admin.query(`DROP DATABASE ${temporaryDatabase} WITH (FORCE)`);
    }
    await admin.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
