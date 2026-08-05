import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const projectRoot = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const sqlPath = join(
  projectRoot,
  'scripts',
  'migrations',
  '2026-08-05_import_booking_agents.sql',
);
const migrationId = '2026-08-05_import_booking_agents_v1';
const confirmation = 'APPLY_BOOKING_AGENTS_20260805';
const lockName = 'seatrans:booking-agents:2026-08-05';
const customerIds = [
  'WLSLOGISTI2607004',
  'PT.MATTROY2511003',
  'THEWORLDSH2508007',
];
const agentNames = [
  'WLS LOGISTIC LIMITED',
  'PT. MATTROY LOGISTICS',
  'THE WORLD SHIPPING (CHINA) LIMITED',
];

const normalizedName = (value) =>
  value.trim().replace(/\s+/g, ' ').toUpperCase();

function matchingAgent(rows, index) {
  const expectedName = normalizedName(agentNames[index]);
  return rows.find(
    (row) =>
      row.customer_type === 'AGENT' &&
      (row.customer_id === customerIds[index] ||
        normalizedName(row.name) === expectedName),
  );
}

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
  const args = { apply: false, targetDb: null, confirmation: null };
  for (const argument of argv) {
    if (argument === '--apply') args.apply = true;
    else if (argument === '--dry-run') continue;
    else {
      const [key, ...parts] = argument.split('=');
      const value = parts.join('=');
      if (key === '--target-db') args.targetDb = value;
      else if (key === '--confirm') args.confirmation = value;
      else throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return args;
}

function assertApplyGuards(args, config) {
  if (!args.apply) return;
  if (!args.targetDb || args.targetDb !== config.database) {
    throw new Error('--target-db must exactly match the configured database');
  }
  if (args.confirmation !== confirmation) {
    throw new Error(`--confirm must equal ${confirmation}`);
  }
}

async function inspect(client) {
  const result = await client.query(
    `SELECT p.id, p.customer_id, p.name, p.country, p.city, p.address,
            p.contacts, p.phone, p.fax, p.customer_status, p.customer_type,
            p.tax_number, p.approve_status, p.invoice_company_name,
            p.invoice_company_address, p.invoice_company_phone,
            p.created_by, p.created_at, p.updated_by, p.updated_at,
            p.deleted_at,
            COALESCE(array_agg(t.addition_type::text ORDER BY t.addition_type::text)
              FILTER (WHERE t.addition_type IS NOT NULL), '{}') AS addition_types
       FROM booking_partners p
       LEFT JOIN booking_partner_addition_types t ON t.partner_id = p.id
      WHERE p.customer_id = ANY($1::varchar[])
         OR UPPER(BTRIM(p.name)) = ANY($2::varchar[])
      GROUP BY p.id
      ORDER BY p.customer_id`,
    [customerIds, agentNames.map(normalizedName)],
  );
  return result.rows;
}

function validate(rows) {
  for (const [index, customerId] of customerIds.entries()) {
    const row = matchingAgent(rows, index);
    if (!row) throw new Error(`Missing imported Agent ${customerId}`);
    if (row.deleted_at != null) {
      throw new Error(`Imported Agent ${customerId} is archived`);
    }
    if (row.addition_types.includes('AGENT')) {
      throw new Error(`${customerId} must not use AGENT as an addition type`);
    }
  }
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

function writeLogicalBackup(database, rows) {
  const backupDir = 'D:/agent-migration-backups';
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(backupDir, `${database}-booking-agents-${stamp}.json`);
  const payload = {
    migrationId,
    database,
    createdAt: new Date().toISOString(),
    customerIds,
    existingRows: rows,
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return {
    path,
    checksum: createHash('sha256').update(readFileSync(path)).digest('hex'),
  };
}

async function main() {
  loadEnvFile(join(projectRoot, '.env'));
  loadEnvFile(join(projectRoot, '.env.local'));
  const args = parseArgs(process.argv.slice(2));
  const config = buildClientConfig();
  assertApplyGuards(args, config);
  const sql = readFileSync(sqlPath, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const client = new pg.Client(config);
  await client.connect();
  let lockAcquired = false;
  try {
    if (!args.apply) {
      await client.query('BEGIN TRANSACTION READ ONLY');
      await client.query(`EXPLAIN (COSTS FALSE) ${sql}`);
      const before = await inspect(client);
      await client.query('ROLLBACK');
      console.log(
        JSON.stringify({
          mode: 'dry-run',
          database: config.database,
          migrationId,
          checksum,
          existing: before.map((row) => ({
            id: row.id,
            customerId: row.customer_id,
            name: row.name,
            customerType: row.customer_type,
            additionTypes: row.addition_types,
          })),
          wouldInsert: customerIds.filter(
            (_id, index) => !matchingAgent(before, index),
          ),
          sqlPlanned: true,
          readOnly: true,
        }),
      );
      return;
    }

    const lock = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [lockName],
    );
    lockAcquired = lock.rows[0]?.acquired === true;
    if (!lockAcquired) throw new Error('Agent import is already running');
    await client.query(`SET lock_timeout = '5s'`);
    await client.query(`SET statement_timeout = '60s'`);

    const before = await inspect(client);
    const backup = writeLogicalBackup(config.database, before);
    await ensureLedger(client);
    const ledger = await client.query(
      `SELECT script_checksum, status
         FROM app_schema_migrations
        WHERE migration_id = $1`,
      [migrationId],
    );
    if (ledger.rows[0] && ledger.rows[0].script_checksum !== checksum) {
      throw new Error('Migration already exists with a different checksum');
    }
    if (ledger.rows[0]?.status === 'SUCCEEDED') {
      const after = await inspect(client);
      validate(after);
      console.log(
        JSON.stringify({ alreadyApplied: true, backup: backup.path }),
      );
      return;
    }

    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO app_schema_migrations (
           migration_id, script_checksum, status, backup_reference,
           logical_export_reference, details, started_at, completed_at
         ) VALUES ($1, $2, 'RUNNING', $3, $3, $4::jsonb, NOW(), NULL)
         ON CONFLICT (migration_id) DO UPDATE SET
           script_checksum = EXCLUDED.script_checksum,
           status = 'RUNNING',
           backup_reference = EXCLUDED.backup_reference,
           logical_export_reference = EXCLUDED.logical_export_reference,
           details = EXCLUDED.details,
           started_at = NOW(),
           completed_at = NULL`,
        [
          migrationId,
          checksum,
          backup.path,
          JSON.stringify({ beforeCount: before.length, backup }),
        ],
      );
      await client.query(sql);
      const after = await inspect(client);
      validate(after);
      await client.query(
        `UPDATE app_schema_migrations
            SET status = 'SUCCEEDED', completed_at = NOW(),
                details = details || $2::jsonb
          WHERE migration_id = $1`,
        [migrationId, JSON.stringify({ afterCount: after.length })],
      );
      await client.query('COMMIT');
      console.log(
        JSON.stringify({
          committed: true,
          backup: backup.path,
          inserted: customerIds.filter(
            (_id, index) => !matchingAgent(before, index),
          ),
          preserved: customerIds.filter((_id, index) =>
            Boolean(matchingAgent(before, index)),
          ),
          verified: after.map((row) => ({
            id: row.id,
            customerId: row.customer_id,
            customerType: row.customer_type,
            additionTypes: row.addition_types,
          })),
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
