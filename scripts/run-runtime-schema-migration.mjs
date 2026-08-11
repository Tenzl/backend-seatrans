import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const PROJECT_ROOT = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-07-30_runtime_schema_expand.sql',
);
const MIGRATION_ID = '2026-07-30_runtime_schema_expand';
const CONFIRMATION = 'APPLY_RUNTIME_SCHEMA_20260730';
const LOCK_NAME = 'seatrans:runtime-schema:2026-07-30';

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

function assertApplyGuards(args, config) {
  if (!args.apply) return;
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

  const exportPath = realpathSync(args.logicalExport);
  const exportStat = statSync(exportPath);
  if (!exportStat.isFile() || exportStat.size === 0) {
    throw new Error('--logical-export must be a non-empty file');
  }
  const projectRelative = relative(PROJECT_ROOT, exportPath);
  if (
    projectRelative === '' ||
    (!projectRelative.startsWith('..') && !isAbsolute(projectRelative))
  ) {
    throw new Error('--logical-export must be stored outside backend2.0');
  }
}

function maskHost(host) {
  if (host === 'localhost' || host === '127.0.0.1') return host;
  if (!host) return '(empty)';
  return host.length < 5
    ? `${host[0]}***`
    : `${host.slice(0, 2)}***${host.slice(-2)}`;
}

async function inspectRuntimeSchema(client) {
  const requiredTables = [
    'shipping_agency_inquiries',
    'chartering_broking_inquiries',
    'freight_forwarding_inquiries',
    'total_logistics_inquiries',
    'special_request_inquiries',
    'notifications',
    'shipping_agency_field_change_logs',
    'admin_audit_logs',
  ];
  const tableResult = await client.query(
    `SELECT required.name
       FROM unnest($1::text[]) AS required(name)
      WHERE to_regclass('public.' || required.name) IS NULL
      ORDER BY required.name`,
    [requiredTables],
  );

  const requiredColumns = [
    ['shipping_agency_inquiries', 'customer_submitted_snapshot'],
    ['shipping_agency_inquiries', 'deleted_at'],
    ['shipping_agency_inquiries', 'deleted_by'],
    ['chartering_broking_inquiries', 'deleted_at'],
    ['chartering_broking_inquiries', 'deleted_by'],
    ['freight_forwarding_inquiries', 'deleted_at'],
    ['freight_forwarding_inquiries', 'deleted_by'],
    ['total_logistics_inquiries', 'deleted_at'],
    ['total_logistics_inquiries', 'deleted_by'],
    ['special_request_inquiries', 'deleted_at'],
    ['special_request_inquiries', 'deleted_by'],
  ];
  const columnResult = await client.query(
    `SELECT required.table_name, required.column_name
       FROM jsonb_to_recordset($1::jsonb)
         AS required(table_name text, column_name text)
      WHERE NOT EXISTS (
        SELECT 1
          FROM information_schema.columns column_info
         WHERE column_info.table_schema = 'public'
           AND column_info.table_name = required.table_name
           AND column_info.column_name = required.column_name
      )
      ORDER BY required.table_name, required.column_name`,
    [
      JSON.stringify(
        requiredColumns.map(([table_name, column_name]) => ({
          table_name,
          column_name,
        })),
      ),
    ],
  );

  const missingTableNames = new Set(
    tableResult.rows.map((row) => String(row.name)),
  );
  const countRows = async (tableName) => {
    if (missingTableNames.has(tableName)) return null;
    const result = await client.query(
      `SELECT count(*)::integer AS count FROM ${tableName}`,
    );
    return result.rows[0]?.count ?? 0;
  };
  const counts = {
    notifications: await countRows('notifications'),
    canonicalAuditLogs: await countRows('shipping_agency_field_change_logs'),
    adminAuditLogs: await countRows('admin_audit_logs'),
  };

  return {
    missingTables: tableResult.rows.map((row) => row.name),
    missingColumns: columnResult.rows,
    counts,
  };
}

function assertRuntimeSchema(report) {
  if (report.missingTables.length || report.missingColumns.length) {
    throw new Error(
      `Runtime schema validation failed: ${JSON.stringify({
        missingTables: report.missingTables,
        missingColumns: report.missingColumns,
      })}`,
    );
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

async function main() {
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  loadEnvFile(join(PROJECT_ROOT, '.env.local'));

  const args = parseArgs(process.argv.slice(2));
  const config = buildClientConfig();
  const sql = readFileSync(SQL_PATH, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  assertApplyGuards(args, config);

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
    const before = await inspectRuntimeSchema(client);
    console.log(JSON.stringify({ preflight: before }, null, 2));
    if (!args.apply) {
      console.log('Dry-run only. No schema or ledger changes were written.');
      return;
    }

    const lockResult = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [LOCK_NAME],
    );
    lockAcquired = lockResult.rows[0]?.acquired === true;
    if (!lockAcquired) {
      throw new Error('Another runtime schema migration is already running');
    }

    await client.query(`SET lock_timeout = '5s'`);
    await client.query(`SET statement_timeout = '5min'`);
    await client.query(`SET idle_in_transaction_session_timeout = '60s'`);
    await ensureLedger(client);

    const existing = await client.query(
      `SELECT script_checksum, status
         FROM app_schema_migrations
        WHERE migration_id = $1`,
      [MIGRATION_ID],
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (row.script_checksum !== checksum) {
        throw new Error(
          'Migration ID already exists with a different script checksum',
        );
      }
      if (row.status === 'SUCCEEDED') {
        console.log('Migration already succeeded with the same checksum.');
        return;
      }
    }

    await client.query(
      `INSERT INTO app_schema_migrations (
         migration_id, script_checksum, status, backup_reference,
         logical_export_reference, started_at, completed_at, details
       )
       VALUES ($1, $2, 'RUNNING', $3, $4, NOW(), NULL, NULL)
       ON CONFLICT (migration_id) DO UPDATE SET
         status = 'RUNNING',
         backup_reference = EXCLUDED.backup_reference,
         logical_export_reference = EXCLUDED.logical_export_reference,
         started_at = NOW(),
         completed_at = NULL,
         details = NULL`,
      [
        MIGRATION_ID,
        checksum,
        args.backupReference,
        realpathSync(args.logicalExport),
      ],
    );

    try {
      await client.query('BEGIN');
      await client.query(sql);
      const after = await inspectRuntimeSchema(client);
      assertRuntimeSchema(after);
      await client.query('COMMIT');
      await client.query(
        `UPDATE app_schema_migrations
            SET status = 'SUCCEEDED', completed_at = NOW(), details = $2::jsonb
          WHERE migration_id = $1`,
        [MIGRATION_ID, JSON.stringify(after)],
      );
      console.log(
        JSON.stringify({ committed: true, validation: after }, null, 2),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      await client.query(
        `UPDATE app_schema_migrations
            SET status = 'FAILED', completed_at = NOW(),
                details = jsonb_build_object('error', $2::text)
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
