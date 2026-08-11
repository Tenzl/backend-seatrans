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
  '2026-07-30_relational_integrity_expand.sql',
);
const MIGRATION_ID = '2026-07-30_relational_integrity_expand_v1';
const CONFIRMATION = 'APPLY_RELATIONAL_INTEGRITY_EXPAND_20260730';
const LOCK_NAME = 'seatrans:relational-integrity-expand:2026-07-30:v1';

const FK_SPECS = [
  ['booking_document_records', 'created_by_user_id', 'users', 'r'],
  ['freight_forwarding_inquiries', 'user_id', 'users', 'a'],
  ['freight_forwarding_inquiries', 'processed_by', 'users', 'a'],
  ['freight_forwarding_inquiries', 'deleted_by', 'users', 'n'],
  ['special_request_inquiries', 'user_id', 'users', 'a'],
  ['special_request_inquiries', 'processed_by', 'users', 'a'],
  ['special_request_inquiries', 'deleted_by', 'users', 'n'],
  ['shipping_agency_inquiries', 'user_id', 'users', 'a'],
  ['shipping_agency_inquiries', 'processed_by', 'users', 'a'],
  ['shipping_agency_inquiries', 'deleted_by', 'users', 'n'],
  ['shipping_agency_inquiries', 'quoted_by_user_id', 'users', 'a'],
  ['shipping_agency_inquiries', 'port_id', 'ports', 'n'],
  ['chartering_broking_inquiries', 'user_id', 'users', 'a'],
  ['chartering_broking_inquiries', 'processed_by', 'users', 'a'],
  ['chartering_broking_inquiries', 'deleted_by', 'users', 'n'],
  ['total_logistics_inquiries', 'user_id', 'users', 'a'],
  ['total_logistics_inquiries', 'processed_by', 'users', 'a'],
  ['total_logistics_inquiries', 'deleted_by', 'users', 'n'],
  ['inquiry_documents', 'uploaded_by', 'users', 'a'],
].map(([sourceTable, sourceColumn, targetTable, deleteAction]) => ({
  sourceTable,
  sourceColumn,
  targetTable,
  deleteAction,
}));

const INDEX_NAMES = [
  'idx_booking_document_records_creator_history',
  'idx_freight_forwarding_inquiries_status_active',
  'idx_freight_forwarding_inquiries_processed',
  'idx_freight_forwarding_inquiries_deleted',
  'idx_special_request_inquiries_status_active',
  'idx_special_request_inquiries_processed',
  'idx_special_request_inquiries_deleted',
  'idx_shipping_agency_inquiries_user_active',
  'idx_shipping_agency_inquiries_status_active',
  'idx_shipping_agency_inquiries_processed',
  'idx_shipping_agency_inquiries_deleted',
  'idx_shipping_agency_inquiries_quoted',
  'idx_chartering_broking_inquiries_status_active',
  'idx_chartering_broking_inquiries_processed',
  'idx_chartering_broking_inquiries_deleted',
  'idx_total_logistics_inquiries_status_active',
  'idx_total_logistics_inquiries_processed',
  'idx_total_logistics_inquiries_deleted',
  'idx_inquiry_documents_uploader_history',
  'idx_inquiry_documents_active_target',
  'idx_inquiry_documents_active_target_type',
];

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

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier in migration manifest: ${value}`);
  }
  return `"${value}"`;
}

async function inspectSchema(client) {
  const desiredRelations = [
    ...new Set(
      FK_SPECS.flatMap((spec) => [spec.sourceTable, spec.targetTable]),
    ),
  ];
  const desiredColumns = FK_SPECS.map((spec) => ({
    table_name: spec.sourceTable,
    column_name: spec.sourceColumn,
  }));

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
    const missingTablesResult = await client.query(
      `SELECT desired.table_name
         FROM unnest($1::text[]) AS desired(table_name)
        WHERE to_regclass('public.' || desired.table_name) IS NULL
        ORDER BY desired.table_name`,
      [desiredRelations],
    );
    const missingColumnsResult = await client.query(
      `SELECT desired.table_name, desired.column_name
         FROM jsonb_to_recordset($1::jsonb)
           AS desired(table_name text, column_name text)
        WHERE NOT EXISTS (
          SELECT 1
            FROM information_schema.columns column_info
           WHERE column_info.table_schema = 'public'
             AND column_info.table_name = desired.table_name
             AND column_info.column_name = desired.column_name
        )
        ORDER BY desired.table_name, desired.column_name`,
      [JSON.stringify(desiredColumns)],
    );

    const missingTableSet = new Set(
      missingTablesResult.rows.map((row) => String(row.table_name)),
    );
    const missingColumnSet = new Set(
      missingColumnsResult.rows.map(
        (row) => `${row.table_name}.${row.column_name}`,
      ),
    );

    const foreignKeys = [];
    const orphans = [];
    for (const spec of FK_SPECS) {
      const relationMissing =
        missingTableSet.has(spec.sourceTable) ||
        missingTableSet.has(spec.targetTable);
      const columnMissing = missingColumnSet.has(
        `${spec.sourceTable}.${spec.sourceColumn}`,
      );
      if (relationMissing || columnMissing) {
        foreignKeys.push({ ...spec, existing: null });
        orphans.push({ ...spec, count: null, sampleIds: [] });
        continue;
      }

      const fkResult = await client.query(
        `SELECT constraint_info.conname AS constraint_name,
                constraint_info.convalidated AS validated,
                constraint_info.confdeltype AS delete_action
           FROM pg_constraint constraint_info
           JOIN pg_attribute source_attribute
             ON source_attribute.attrelid = constraint_info.conrelid
            AND source_attribute.attnum = constraint_info.conkey[1]
          WHERE constraint_info.contype = 'f'
            AND constraint_info.conrelid = to_regclass($1)
            AND constraint_info.confrelid = to_regclass($2)
            AND cardinality(constraint_info.conkey) = 1
            AND source_attribute.attname = $3
          ORDER BY constraint_info.oid
          LIMIT 1`,
        [
          `public.${spec.sourceTable}`,
          `public.${spec.targetTable}`,
          spec.sourceColumn,
        ],
      );
      foreignKeys.push({
        ...spec,
        existing: fkResult.rows[0] ?? null,
      });

      const sourceTable = quoteIdentifier(spec.sourceTable);
      const sourceColumn = quoteIdentifier(spec.sourceColumn);
      const targetTable = quoteIdentifier(spec.targetTable);
      const orphanResult = await client.query(
        `SELECT count(*)::integer AS count,
                coalesce(
                  (array_agg(source_row.id::text ORDER BY source_row.id)
                    FILTER (WHERE source_row.id IS NOT NULL))[1:20],
                  ARRAY[]::text[]
                ) AS sample_ids
           FROM ${sourceTable} source_row
           LEFT JOIN ${targetTable} target_row
             ON target_row.id = source_row.${sourceColumn}
          WHERE source_row.${sourceColumn} IS NOT NULL
            AND target_row.id IS NULL`,
      );
      orphans.push({
        ...spec,
        count: orphanResult.rows[0]?.count ?? 0,
        sampleIds: orphanResult.rows[0]?.sample_ids ?? [],
      });
    }

    const indexResult = await client.query(
      `SELECT desired.index_name,
              index_info.indisvalid AS valid,
              index_info.indisready AS ready,
              pg_get_indexdef(index_info.indexrelid) AS definition
         FROM unnest($1::text[]) AS desired(index_name)
         LEFT JOIN pg_class index_class
           ON index_class.relname = desired.index_name
          AND index_class.relnamespace = 'public'::regnamespace
         LEFT JOIN pg_index index_info
           ON index_info.indexrelid = index_class.oid
        ORDER BY desired.index_name`,
      [INDEX_NAMES],
    );

    const indexes = indexResult.rows.map((item) => ({
      ...item,
      semanticEquivalent: null,
    }));

    await client.query('COMMIT');
    return {
      identity: identityResult.rows[0],
      missingTables: missingTablesResult.rows.map((row) => row.table_name),
      missingColumns: missingColumnsResult.rows,
      foreignKeys,
      orphans,
      indexes,
      duplicateBookingPartners: [],
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function summarize(report) {
  const missingForeignKeys = report.foreignKeys
    .filter((item) => item.existing === null)
    .map((item) => `${item.sourceTable}.${item.sourceColumn}`);
  const deleteActionMismatches = report.foreignKeys
    .filter(
      (item) =>
        item.existing !== null &&
        item.existing.delete_action !== item.deleteAction,
    )
    .map((item) => ({
      relation: `${item.sourceTable}.${item.sourceColumn}`,
      expected: item.deleteAction,
      actual: item.existing.delete_action,
      constraint: item.existing.constraint_name,
    }));
  const orphanRelations = report.orphans.filter(
    (item) => typeof item.count === 'number' && item.count > 0,
  );
  const coveredIndexes = report.indexes
    .filter(
      (item) => item.definition != null || item.semanticEquivalent != null,
    )
    .map((item) => item.index_name);
  const missingIndexes = report.indexes
    .filter(
      (item) => item.definition == null && item.semanticEquivalent == null,
    )
    .map((item) => item.index_name);
  const invalidIndexes = report.indexes
    .filter((item) => {
      const coverage = item.definition != null ? item : item.semanticEquivalent;
      return (
        coverage != null && (coverage.valid !== true || coverage.ready !== true)
      );
    })
    .map((item) => item.index_name);

  return {
    missingTables: report.missingTables,
    missingColumns: report.missingColumns,
    missingForeignKeys,
    deleteActionMismatches,
    orphanRelations,
    coveredIndexes,
    missingIndexes,
    invalidIndexes,
    duplicateBookingPartners: report.duplicateBookingPartners,
  };
}

function assertSafeToApply(summary) {
  const blockers = {
    missingTables: summary.missingTables,
    missingColumns: summary.missingColumns,
    deleteActionMismatches: summary.deleteActionMismatches,
    orphanRelations: summary.orphanRelations,
    invalidIndexes: summary.invalidIndexes,
    duplicateBookingPartners: summary.duplicateBookingPartners,
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

function splitStatements(sql) {
  return sql
    .split(/\r?\n-- statement-break\r?\n/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function getCreatedIndexName(statement) {
  const match = statement.match(
    /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+([a-z][a-z0-9_]*)/i,
  );
  return match?.[1] ?? null;
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
        'Another relational-integrity migration audit is already running',
      );
    }

    const before = await inspectSchema(client);
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

    for (const statement of splitStatements(sql)) {
      const indexName = getCreatedIndexName(statement);
      if (indexName && beforeSummary.coveredIndexes.includes(indexName)) {
        console.log(
          `Skipping ${indexName}; a valid equivalent index already exists.`,
        );
        continue;
      }
      await client.query(statement);
    }

    const after = await inspectSchema(client);
    const afterSummary = summarize(after);
    assertSafeToApply(afterSummary);
    if (
      afterSummary.missingForeignKeys.length > 0 ||
      afterSummary.missingIndexes.length > 0
    ) {
      throw new Error(
        `Postflight did not find every expanded object: ${JSON.stringify(
          afterSummary,
        )}`,
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
