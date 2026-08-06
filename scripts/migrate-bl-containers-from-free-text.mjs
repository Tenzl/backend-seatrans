import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

/**
 * Optional one-time backfill: seed `containers` on bill_of_lading_records
 * that only have legacy free-text cargo fields.
 *
 * App normalize-on-read/write already handles this; run only if you want
 * stored JSONB updated in place.
 *
 * Usage (from backend2.0):
 *   node scripts/migrate-bl-containers-from-free-text.mjs
 */

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

/** Mirrors backend2.0/src/features/booking-documents/an-container.ts */
function legacyBlCargoTextToContainers(payload) {
  const description =
    typeof payload.descriptionOfGoods === 'string'
      ? payload.descriptionOfGoods.trim()
      : '';
  const grossWeight =
    typeof payload.grossWeight === 'string' ? payload.grossWeight.trim() : '';
  const measurement =
    typeof payload.measurement === 'string' ? payload.measurement.trim() : '';
  const packages =
    typeof payload.numberAndKindOfPackages === 'string'
      ? payload.numberAndKindOfPackages.trim()
      : '';
  if (!description && !grossWeight && !measurement && !packages) return [];

  const pkgParts = packages.split(/\s+/).filter(Boolean);
  return [
    {
      type: '',
      containerNo: '',
      sealNo: '',
      grossWeight,
      measurement,
      tare: '',
      packageType: pkgParts.slice(1).join(' '),
      noOfPkgs: pkgParts[0] ?? '',
      note: description,
      method: '',
    },
  ];
}

function needsContainers(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const containers = payload.containers;
  if (Array.isArray(containers) && containers.length > 0) return false;
  return Boolean(
    String(payload.descriptionOfGoods ?? '').trim() ||
      String(payload.grossWeight ?? '').trim() ||
      String(payload.measurement ?? '').trim() ||
      String(payload.numberAndKindOfPackages ?? '').trim(),
  );
}

loadEnv(join(root, '.env'));
loadEnv(join(root, '.env.local'));

const config = buildClientConfig();
const client = new pg.Client(config);

await client.connect();
try {
  console.log(
    JSON.stringify({
      database: config.database,
      applying: 'migrate-bl-containers-from-free-text',
    }),
  );

  await client.query('BEGIN');
  const { rows } = await client.query(`
    SELECT id, payload
      FROM bill_of_lading_records
     WHERE deleted_at IS NULL
  `);

  let updated = 0;
  for (const row of rows) {
    const payload =
      typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    if (!needsContainers(payload)) continue;
    const containers = legacyBlCargoTextToContainers(payload);
    if (containers.length === 0) continue;
    const next = { ...payload, containers };
    await client.query(
      `UPDATE bill_of_lading_records SET payload = $2::jsonb WHERE id = $1`,
      [row.id, JSON.stringify(next)],
    );
    updated += 1;
  }

  await client.query('COMMIT');
  console.log(
    JSON.stringify(
      {
        ok: true,
        scanned: rows.length,
        updated,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end();
}
