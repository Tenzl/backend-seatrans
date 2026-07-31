import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
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
  '2026-07-30_roles_name_normalized_unique.sql',
);
const MIGRATION_ID = '2026-07-30_roles_name_normalized_unique_v1';
const INDEX_NAME = 'uq_roles_name_normalized';
const LOCK_NAME = 'seatrans:roles-name-normalized-unique:2026-07-30:v1';
const CONFIRMATION = 'APPLY_ROLES_NAME_NORMALIZED_UNIQUE_20260730';

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

    const [key, ...valueParts] = argument.split('=');
    const value = valueParts.join('=');
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

function normalizeExpression(expression) {
  return String(expression ?? '')
    .toLowerCase()
    .replace(/pg_catalog\./g, '')
    .replace(/::(?:text|character varying|varchar)/g, '')
    .replace(/["\s()]/g, '');
}

function isEquivalentExpression(expression) {
  return new Set([
    'lowerbtrimname',
    'lowertrimname',
    'lowertrimbothfromname',
  ]).has(normalizeExpression(expression));
}

function isSemanticEquivalentIndex(index) {
  const normalizedPredicate = normalizeExpression(index.predicate);
  const coversEveryNonNullRoleName =
    index.predicate == null || normalizedPredicate === 'nameisnotnull';

  return (
    index.is_unique === true &&
    index.is_valid === true &&
    index.is_ready === true &&
    index.access_method === 'btree' &&
    coversEveryNonNullRoleName &&
    Number(index.key_attribute_count) === 1 &&
    isEquivalentExpression(index.expression) &&
    !/\bCOLLATE\b/i.test(index.definition ?? '')
  );
}

async function inspectRoles(client) {
  await client.query('BEGIN READ ONLY');
  try {
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    await client.query(`SET LOCAL statement_timeout = '2min'`);
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = '30s'`);

    const identityResult = await client.query(
      `SELECT current_database() AS database,
              current_user AS database_user,
              current_setting('server_version') AS server_version`,
    );
    const tableResult = await client.query(
      `SELECT to_regclass('public.roles') IS NOT NULL AS exists`,
    );
    const tableExists = tableResult.rows[0]?.exists === true;
    if (!tableExists) {
      await client.query('COMMIT');
      return {
        identity: identityResult.rows[0],
        tableExists: false,
        nameColumn: null,
        rowCount: null,
        rowChecksum: null,
        duplicates: [],
        indexes: [],
      };
    }

    const columnResult = await client.query(
      `SELECT data_type, is_nullable, character_maximum_length
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'roles'
          AND column_name = 'name'`,
    );
    const snapshotResult = await client.query(
      `SELECT count(*)::integer AS row_count,
              md5(
                coalesce(
                  string_agg(
                    id::text || ':' || coalesce(name, '<NULL>'),
                    '|' ORDER BY id
                  ),
                  ''
                )
              ) AS row_checksum
         FROM roles`,
    );
    const duplicateResult = await client.query(
      `SELECT lower(btrim(name)) AS normalized_name,
              count(*)::integer AS duplicate_count,
              json_agg(
                json_build_object('id', id, 'name', name)
                ORDER BY id
              ) AS records
         FROM roles
        GROUP BY lower(btrim(name))
       HAVING count(*) > 1
        ORDER BY lower(btrim(name))`,
    );
    const indexResult = await client.query(
      `SELECT index_class.relname AS index_name,
              index_info.indisunique AS is_unique,
              index_info.indisvalid AS is_valid,
              index_info.indisready AS is_ready,
              access_method.amname AS access_method,
              index_info.indnkeyatts AS key_attribute_count,
              index_info.indnatts AS total_attribute_count,
              pg_get_expr(
                index_info.indexprs,
                index_info.indrelid,
                TRUE
              ) AS expression,
              pg_get_expr(
                index_info.indpred,
                index_info.indrelid,
                TRUE
              ) AS predicate,
              pg_get_indexdef(index_info.indexrelid) AS definition
         FROM pg_index index_info
         JOIN pg_class index_class
           ON index_class.oid = index_info.indexrelid
         JOIN pg_class table_class
           ON table_class.oid = index_info.indrelid
         JOIN pg_namespace table_namespace
           ON table_namespace.oid = table_class.relnamespace
         JOIN pg_am access_method
           ON access_method.oid = index_class.relam
        WHERE table_namespace.nspname = 'public'
          AND table_class.relname = 'roles'
        ORDER BY index_class.relname`,
    );

    await client.query('COMMIT');
    return {
      identity: identityResult.rows[0],
      tableExists: true,
      nameColumn: columnResult.rows[0] ?? null,
      rowCount: snapshotResult.rows[0]?.row_count ?? 0,
      rowChecksum: snapshotResult.rows[0]?.row_checksum ?? null,
      duplicates: duplicateResult.rows,
      indexes: indexResult.rows,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function summarize(report) {
  const equivalentIndexes = report.indexes
    .filter(isSemanticEquivalentIndex)
    .map((index) => ({
      name: index.index_name,
      definition: index.definition,
    }));
  const targetIndex = report.indexes.find(
    (index) => index.index_name === INDEX_NAME,
  );
  const targetNameConflict =
    equivalentIndexes.length === 0 &&
    targetIndex &&
    !isSemanticEquivalentIndex(targetIndex)
      ? [
          {
            name: targetIndex.index_name,
            isUnique: targetIndex.is_unique,
            isValid: targetIndex.is_valid,
            isReady: targetIndex.is_ready,
            expression: targetIndex.expression,
            predicate: targetIndex.predicate,
            definition: targetIndex.definition,
          },
        ]
      : [];
  const targetNameWarnings =
    equivalentIndexes.length > 0 &&
    targetIndex &&
    !isSemanticEquivalentIndex(targetIndex)
      ? [
          {
            name: targetIndex.index_name,
            isValid: targetIndex.is_valid,
            isReady: targetIndex.is_ready,
            definition: targetIndex.definition,
          },
        ]
      : [];

  return {
    tableExists: report.tableExists,
    nameColumn: report.nameColumn,
    rowCount: report.rowCount,
    rowChecksum: report.rowChecksum,
    duplicates: report.duplicates,
    equivalentIndexes,
    targetNameConflict,
    targetNameWarnings,
    alreadyCovered: equivalentIndexes.length > 0,
  };
}

function assertSafeToApply(summary) {
  const blockers = {
    missingRolesTable: summary.tableExists ? [] : ['public.roles'],
    missingNameColumn: summary.nameColumn ? [] : ['public.roles.name'],
    nullableNameColumn:
      summary.nameColumn?.is_nullable === 'NO'
        ? []
        : ['public.roles.name must be NOT NULL'],
    duplicates: summary.duplicates,
    targetNameConflict: summary.targetNameConflict,
  };
  if (Object.values(blockers).some((items) => items.length > 0)) {
    throw new Error(
      `Preflight found blockers; no schema changes were made: ${JSON.stringify(
        blockers,
      )}`,
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
  let ledgerStarted = false;
  try {
    const lockResult = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [LOCK_NAME],
    );
    lockAcquired = lockResult.rows[0]?.acquired === true;
    if (!lockAcquired) {
      throw new Error(
        'Another roles-name uniqueness migration audit is already running',
      );
    }

    const before = await inspectRoles(client);
    const beforeSummary = summarize(before);
    console.log(
      JSON.stringify(
        {
          databaseIdentity: before.identity,
          preflight: beforeSummary,
        },
        null,
        2,
      ),
    );

    if (!args.apply) {
      assertSafeToApply(beforeSummary);
      console.log(
        'Dry-run only. The audit used a READ ONLY transaction; no schema or ledger changes were written.',
      );
      return;
    }
    assertSafeToApply(beforeSummary);

    await client.query(`SET lock_timeout = '5s'`);
    await client.query(`SET statement_timeout = '10min'`);
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
        if (!beforeSummary.alreadyCovered) {
          throw new Error(
            'Migration ledger says SUCCEEDED but the normalized unique index is missing',
          );
        }
        console.log('Migration already succeeded with the same checksum.');
        return;
      }
    }

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
        realpathSync(args.logicalExport),
        JSON.stringify({ preflight: beforeSummary }),
      ],
    );
    ledgerStarted = true;

    if (beforeSummary.alreadyCovered) {
      console.log(
        'Skipping index build; a valid semantic equivalent already exists.',
      );
    } else {
      await client.query(sql);
    }

    const after = await inspectRoles(client);
    const afterSummary = summarize(after);
    assertSafeToApply(afterSummary);
    if (!afterSummary.alreadyCovered) {
      throw new Error(
        'Postflight did not find a valid normalized unique role-name index',
      );
    }

    await client.query(
      `UPDATE app_schema_migrations
          SET status = 'SUCCEEDED', completed_at = NOW(), details = $2::jsonb
        WHERE migration_id = $1`,
      [
        MIGRATION_ID,
        JSON.stringify({ before: beforeSummary, after: afterSummary }),
      ],
    );
    console.log(
      JSON.stringify({ applied: true, validation: afterSummary }, null, 2),
    );
  } catch (error) {
    if (ledgerStarted) {
      await client.query(
        `UPDATE app_schema_migrations
            SET status = 'FAILED', completed_at = NOW(),
                details = coalesce(details, '{}'::jsonb)
                  || jsonb_build_object('error', $2::text)
          WHERE migration_id = $1`,
        [MIGRATION_ID, error instanceof Error ? error.message : String(error)],
      );
    }
    throw error;
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
