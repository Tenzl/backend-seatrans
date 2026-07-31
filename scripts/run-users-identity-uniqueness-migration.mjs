import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  INDEX_SPECS,
  assertSafeToApply,
  indexStatementsByName,
  parseArgs,
  summarize,
} from './lib/users-identity-uniqueness-support.mjs';

const PROJECT_ROOT = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-07-30_users_identity_semantic_unique.sql',
);
const MIGRATION_ID = '2026-07-30_users_identity_semantic_unique_v1';
const LOCK_NAME = 'seatrans:users-identity-semantic-unique:2026-07-30:v1';
const CONFIRMATION = 'APPLY_USERS_IDENTITY_SEMANTIC_UNIQUE_20260730';

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

async function fileChecksum(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function assertApplyGuards(args, config) {
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
  return {
    path: exportPath,
    size: exportStat.size,
    checksum: await fileChecksum(exportPath),
  };
}

function maskHost(host) {
  if (host === 'localhost' || host === '127.0.0.1') return host;
  if (!host) return '(empty)';
  return host.length < 5
    ? `${host[0]}***`
    : `${host.slice(0, 2)}***${host.slice(-2)}`;
}

async function inspectUsers(client, expectedScriptChecksum) {
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
      `SELECT to_regclass('public.users') IS NOT NULL AS exists`,
    );
    const ledgerTableResult = await client.query(
      `SELECT to_regclass(
         'public.app_schema_migrations'
       ) IS NOT NULL AS exists`,
    );
    const ledgerTableExists = ledgerTableResult.rows[0]?.exists === true;
    let ledgerCompatible = true;
    let ledgerEntry = null;
    if (ledgerTableExists) {
      const ledgerColumns = await client.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'app_schema_migrations'
            AND column_name IN ('migration_id', 'script_checksum', 'status')`,
      );
      const availableColumns = new Set(
        ledgerColumns.rows.map((column) => column.column_name),
      );
      ledgerCompatible = ['migration_id', 'script_checksum', 'status'].every(
        (column) => availableColumns.has(column),
      );
      if (ledgerCompatible) {
        const ledgerResult = await client.query(
          `SELECT migration_id, script_checksum, status
             FROM public.app_schema_migrations
            WHERE migration_id = $1`,
          [MIGRATION_ID],
        );
        ledgerEntry = ledgerResult.rows[0] ?? null;
      }
    }
    const ledger = {
      tableExists: ledgerTableExists,
      compatible: ledgerCompatible,
      entry: ledgerEntry,
    };
    const tableExists = tableResult.rows[0]?.exists === true;
    if (!tableExists) {
      await client.query('COMMIT');
      return {
        identity: identityResult.rows[0],
        tableExists: false,
        columns: [],
        rowCount: null,
        rowChecksum: null,
        duplicates: { email: [], username: [], oauthIdentity: [] },
        indexes: [],
        ledger,
        expectedScriptChecksum,
      };
    }

    const columnsResult = await client.query(
      `SELECT column_name, data_type, is_nullable, character_maximum_length
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name IN (
            'id', 'email', 'username', 'oauth_provider', 'oauth_provider_id'
          )
        ORDER BY column_name`,
    );
    const snapshotResult = await client.query(
      `SELECT count(*)::integer AS row_count,
              md5(
                coalesce(
                  string_agg(
                    md5(
                      json_build_array(
                        id,
                        email,
                        username,
                        oauth_provider,
                        oauth_provider_id
                      )::text
                    ),
                    '' ORDER BY id
                  ),
                  ''
                )
              ) AS row_checksum
         FROM users`,
    );
    const emailDuplicates = await client.query(
      `SELECT md5(lower(btrim(email))) AS identity_fingerprint,
              count(*)::integer AS duplicate_count,
              json_agg(id ORDER BY id) AS record_ids
         FROM users
        WHERE email IS NOT NULL
        GROUP BY lower(btrim(email))
       HAVING count(*) > 1
        ORDER BY md5(lower(btrim(email)))`,
    );
    const usernameDuplicates = await client.query(
      `SELECT md5(lower(btrim(username))) AS identity_fingerprint,
              count(*)::integer AS duplicate_count,
              json_agg(id ORDER BY id) AS record_ids
         FROM users
        WHERE username IS NOT NULL
          AND btrim(username) <> ''
        GROUP BY lower(btrim(username))
       HAVING count(*) > 1
        ORDER BY md5(lower(btrim(username)))`,
    );
    const oauthDuplicates = await client.query(
      `SELECT lower(btrim(oauth_provider)) AS oauth_provider,
              md5(
                lower(btrim(oauth_provider))
                || chr(31)
                || btrim(oauth_provider_id)
              ) AS identity_fingerprint,
              count(*)::integer AS duplicate_count,
              json_agg(id ORDER BY id) AS record_ids
         FROM users
        WHERE oauth_provider IS NOT NULL
          AND btrim(oauth_provider) <> ''
          AND oauth_provider_id IS NOT NULL
          AND btrim(oauth_provider_id) <> ''
        GROUP BY lower(btrim(oauth_provider)), btrim(oauth_provider_id)
       HAVING count(*) > 1
        ORDER BY lower(btrim(oauth_provider)),
                 md5(
                   lower(btrim(oauth_provider))
                   || chr(31)
                   || btrim(oauth_provider_id)
                 )`,
    );
    const indexResult = await client.query(
      `SELECT table_class.relname AS table_name,
              index_class.relname AS index_name,
              index_info.indisunique AS is_unique,
              index_info.indisvalid AS is_valid,
              index_info.indisready AS is_ready,
              access_method.amname AS access_method,
              index_info.indnkeyatts AS key_attribute_count,
              index_info.indnatts AS total_attribute_count,
              ARRAY(
                SELECT pg_get_indexdef(
                  index_info.indexrelid,
                  key_position,
                  TRUE
                )
                  FROM generate_series(
                    1,
                    index_info.indnkeyatts
                  ) AS key_position
                 ORDER BY key_position
              ) AS key_expressions,
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
          AND (
            table_class.relname = 'users'
            OR index_class.relname IN (
              'uq_users_email_normalized',
              'uq_users_username_normalized_nonblank',
              'uq_users_oauth_identity'
            )
          )
        ORDER BY index_class.relname`,
    );

    await client.query('COMMIT');
    return {
      identity: identityResult.rows[0],
      tableExists: true,
      columns: columnsResult.rows,
      rowCount: snapshotResult.rows[0]?.row_count ?? 0,
      rowChecksum: snapshotResult.rows[0]?.row_checksum ?? null,
      duplicates: {
        email: emailDuplicates.rows,
        username: usernameDuplicates.rows,
        oauthIdentity: oauthDuplicates.rows,
      },
      indexes: indexResult.rows,
      ledger,
      expectedScriptChecksum,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.app_schema_migrations (
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
  const statements = indexStatementsByName(sql);
  const scriptChecksum = createHash('sha256').update(sql).digest('hex');
  const logicalExport = await assertApplyGuards(args, config);

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? 'apply' : 'dry-run',
        migrationId: MIGRATION_ID,
        scriptChecksum,
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
        'Another users-identity uniqueness migration audit is already running',
      );
    }

    const before = await inspectUsers(client, scriptChecksum);
    if (before.identity?.database !== config.database) {
      throw new Error(
        'Connected database identity does not match configuration',
      );
    }
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
    await client.query(`SET statement_timeout = '20min'`);
    await client.query(`SET idle_in_transaction_session_timeout = '60s'`);
    await ensureLedger(client);

    const existing = await client.query(
      `SELECT script_checksum, status
         FROM public.app_schema_migrations
        WHERE migration_id = $1`,
      [MIGRATION_ID],
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (row.script_checksum !== scriptChecksum) {
        throw new Error(
          'Migration ID already exists with a different script checksum',
        );
      }
      if (row.status === 'SUCCEEDED') {
        const allCovered = Object.values(beforeSummary.indexes).every(
          (index) => index.alreadyCovered,
        );
        if (!allCovered) {
          throw new Error(
            'Migration ledger says SUCCEEDED but an identity unique index is missing',
          );
        }
        console.log('Migration already succeeded with the same checksum.');
        return;
      }
    }

    await client.query(
      `INSERT INTO public.app_schema_migrations (
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
        scriptChecksum,
        args.backupReference,
        logicalExport.path,
        JSON.stringify({
          logicalExport: {
            size: logicalExport.size,
            checksum: logicalExport.checksum,
          },
          preflight: beforeSummary,
        }),
      ],
    );
    ledgerStarted = true;

    for (const spec of INDEX_SPECS) {
      if (beforeSummary.indexes[spec.key].alreadyCovered) {
        console.log(
          `Skipping ${spec.targetName}; a valid semantic equivalent already exists.`,
        );
        continue;
      }
      await client.query(statements.get(spec.targetName));
    }

    const after = await inspectUsers(client, scriptChecksum);
    const afterSummary = summarize(after);
    assertSafeToApply(afterSummary);
    const missingAfter = Object.values(afterSummary.indexes)
      .filter((index) => !index.alreadyCovered)
      .map((index) => index.targetName);
    if (missingAfter.length > 0) {
      throw new Error(
        `Postflight did not find all identity indexes: ${missingAfter.join(', ')}`,
      );
    }

    await client.query(
      `UPDATE public.app_schema_migrations
          SET status = 'SUCCEEDED', completed_at = NOW(), details = $2::jsonb
        WHERE migration_id = $1`,
      [
        MIGRATION_ID,
        JSON.stringify({
          logicalExport: {
            size: logicalExport.size,
            checksum: logicalExport.checksum,
          },
          before: beforeSummary,
          after: afterSummary,
        }),
      ],
    );
    console.log(
      JSON.stringify({ applied: true, validation: afterSummary }, null, 2),
    );
  } catch (error) {
    if (ledgerStarted) {
      await client.query(
        `UPDATE public.app_schema_migrations
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
