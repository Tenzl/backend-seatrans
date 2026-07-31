import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

const root = resolve(import.meta.dirname, '..');

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
  const explicit = process.env.DB_SSL?.trim().toLowerCase();
  const ssl = ['true', '1', 'require', 'verify-ca', 'verify-full'].includes(
    explicit ?? '',
  )
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

loadEnv(join(root, '.env'));
loadEnv(join(root, '.env.local'));

const config = buildClientConfig();
const sqlFiles = [
  '2026-07-31_booking_partner_field_change_logs.sql',
  '2026-07-31_booking_partner_locked_at.sql',
];
const client = new pg.Client(config);

await client.connect();
try {
  console.log(
    JSON.stringify({
      database: config.database,
      host:
        config.host === 'localhost' || config.host === '127.0.0.1'
          ? config.host
          : '***',
      applying: sqlFiles,
    }),
  );

  await client.query('BEGIN');
  for (const fileName of sqlFiles) {
    const sql = readFileSync(
      join(root, 'scripts', 'migrations', fileName),
      'utf8',
    );
    await client.query(sql);
  }
  await client.query('COMMIT');

  const check = await client.query(`
    SELECT
      to_regclass('public.booking_partner_field_change_logs') AS logs_table,
      EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'booking_partners'
           AND column_name = 'locked_at'
      ) AS has_locked_at
  `);

  console.log(JSON.stringify({ ok: true, ...check.rows[0] }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end();
}
