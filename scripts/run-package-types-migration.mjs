import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const PROJECT_ROOT = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const EXPAND_SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-08-19_package_types_expand.sql',
);
const DATA_SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-08-19_package_types_data.sql',
);
const PHASE_CONFIRMATIONS = {
  expand: 'APPLY_PACKAGE_TYPES_EXPAND_20260819',
  data: 'APPLY_PACKAGE_TYPES_DATA_20260819',
};
const LOCK_NAME = 'seatrans:package-types-expand:2026-08-19:v1';
const DOCUMENT_TABLES = [
  'booking_records',
  'arrival_notice_records',
  'delivery_order_records',
  'bill_of_lading_records',
];
const PACKAGE_TYPE_SOURCE_TABLES = DOCUMENT_TABLES.filter(
  (table) => table !== 'booking_records',
);
const EXPECTED_COLUMNS = new Map([
  ['id', { type: 'integer', length: null }],
  ['code', { type: 'character varying', length: 200 }],
  ['display_name', { type: 'character varying', length: 200 }],
  ['is_active', { type: 'boolean', length: null }],
  ['sort_order', { type: 'integer', length: null }],
  ['created_at', { type: 'timestamp with time zone', length: null }],
  ['updated_at', { type: 'timestamp with time zone', length: null }],
]);

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
  const args = {
    mode: 'verify',
    phase: 'expand',
    targetDb: null,
    backupReference: null,
    logicalExport: null,
    confirmation: null,
  };
  for (const argument of argv) {
    if (argument === '--verify' || argument === '--dry-run') {
      args.mode = 'verify';
      continue;
    }
    if (argument === '--preflight') {
      args.mode = 'preflight';
      continue;
    }
    if (argument === '--apply') {
      args.mode = 'apply';
      continue;
    }
    const [key, ...parts] = argument.split('=');
    const value = parts.join('=');
    if (key === '--phase') {
      if (!['expand', 'data', 'all'].includes(value)) {
        throw new Error('--phase must be expand, data, or all');
      }
      args.phase = value;
    } else if (key === '--target-db') args.targetDb = value;
    else if (key === '--backup-reference') args.backupReference = value;
    else if (key === '--logical-export') args.logicalExport = value;
    else if (key === '--confirm') args.confirmation = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (args.mode === 'apply' && args.phase === 'all') {
    throw new Error('--apply cannot be combined with --phase=all');
  }
  return args;
}

function verifyStaticMigration(sql) {
  const requiredPatterns = [
    [/CREATE TABLE IF NOT EXISTS public\.package_types/i, 'idempotent table'],
    [/\bcode\s+VARCHAR\(200\)\s+NOT NULL/i, 'stable code'],
    [/\bdisplay_name\s+VARCHAR\(200\)\s+NOT NULL/i, 'display name'],
    [/\bis_active\s+BOOLEAN\s+NOT NULL\s+DEFAULT TRUE/i, 'active flag'],
    [/\bsort_order\s+INTEGER\s+NOT NULL\s+DEFAULT 0/i, 'sort order'],
    [/\bcreated_at\s+TIMESTAMPTZ\s+NOT NULL/i, 'created timestamp'],
    [/\bupdated_at\s+TIMESTAMPTZ\s+NOT NULL/i, 'updated timestamp'],
    [
      /CREATE UNIQUE INDEX IF NOT EXISTS\s+uq_package_types_code_normalized[\s\S]*?lower\s*\(\s*regexp_replace\s*\(\s*btrim\s*\(\s*code\s*\)/i,
      'case/space-normalized unique index',
    ],
  ];
  const missing = requiredPatterns
    .filter(([pattern]) => !pattern.test(sql))
    .map(([, label]) => label);
  if (missing.length > 0) {
    throw new Error(`Static verification failed: ${missing.join(', ')}`);
  }
  if (/\bREFERENCES\b/i.test(sql)) {
    throw new Error('Package Type expand migration must not add dependencies');
  }
  if (/\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/i.test(sql)) {
    throw new Error('Package Type expand migration must contain DDL only');
  }
  for (const table of DOCUMENT_TABLES) {
    const mutation = new RegExp(
      `(?:ALTER|CREATE|COMMENT)\\s+TABLE[^;]*\\b${table}\\b`,
      'i',
    );
    if (mutation.test(sql)) {
      throw new Error(`Expand migration must not alter ${table}`);
    }
  }
}

function canonicalValuesFromDataSql(sql) {
  const block = sql.match(
    /-- CANONICAL_PACKAGE_TYPES_BEGIN([\s\S]*?)-- CANONICAL_PACKAGE_TYPES_END/,
  )?.[1];
  if (!block) throw new Error('Data migration canonical seed block is missing');
  return [...block.matchAll(/\('((?:''|[^'])*)',\s*(\d+)\)/g)].map(
    ([, value, order]) => ({
      displayName: value.replaceAll("''", "'"),
      sortOrder: Number(order),
    }),
  );
}

function verifyStaticDataMigration(sql) {
  const canonical = canonicalValuesFromDataSql(sql);
  if (
    canonical.length !== 101 ||
    canonical.some((item, index) => item.sortOrder !== index + 1) ||
    new Set(canonical.map((item) => normalizePackageTypeCode(item.displayName)))
      .size !== 101
  ) {
    throw new Error('Data migration must seed 101 values in positions 1..101');
  }
  for (const table of PACKAGE_TYPE_SOURCE_TABLES) {
    if (!new RegExp(`\\bFROM\\s+public\\.${table}\\b`, 'i').test(sql)) {
      throw new Error(`Data migration does not read ${table}`);
    }
    const mutation = new RegExp(
      `\\b(?:UPDATE|INSERT|DELETE|ALTER)\\s+(?:TABLE\\s+)?public\\.${table}\\b`,
      'i',
    );
    if (mutation.test(sql)) {
      throw new Error(`Data migration must not mutate ${table}`);
    }
  }
  if (/deleted_at\s+IS\s+NULL/i.test(sql)) {
    throw new Error('Data migration must include historical document rows');
  }
  if (/\b(?:left|substring|substr)\s*\(/i.test(sql)) {
    throw new Error('Data migration must not truncate Package Type snapshots');
  }
  if (
    !/jsonb_array_elements/i.test(sql) ||
    !/container\s*->>\s*'packageType'/i.test(sql) ||
    !/ON CONFLICT/i.test(sql)
  ) {
    throw new Error(
      'Data migration extraction or idempotency guard is missing',
    );
  }
  return canonical;
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
      database: parsed.pathname.replace(/^\/+/, ''),
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

function verifyApplyGuards(args, config) {
  if (args.targetDb !== config.database) {
    throw new Error('--target-db must exactly match the configured database');
  }
  if (!args.backupReference?.trim()) {
    throw new Error('--backup-reference is required for --apply');
  }
  const requiredConfirmation = PHASE_CONFIRMATIONS[args.phase];
  if (!requiredConfirmation || args.confirmation !== requiredConfirmation) {
    throw new Error(`--confirm must equal ${requiredConfirmation}`);
  }
  if (!args.logicalExport || !isAbsolute(args.logicalExport)) {
    throw new Error('--logical-export must be an absolute existing file');
  }
  const exportPath = realpathSync(args.logicalExport);
  const stats = statSync(exportPath);
  if (!stats.isFile() || stats.size === 0) {
    throw new Error('--logical-export must be a non-empty file');
  }
  const projectRelative = relative(PROJECT_ROOT, exportPath);
  if (
    projectRelative === '' ||
    (!projectRelative.startsWith('..') && !isAbsolute(projectRelative))
  ) {
    throw new Error('--logical-export must be stored outside backend2.0');
  }
  return { path: exportPath, size: stats.size };
}

async function inspectDocumentTables(client) {
  const snapshots = {};
  for (const table of DOCUMENT_TABLES) {
    const exists = await client.query(
      'SELECT to_regclass($1) IS NOT NULL AS exists',
      [`public.${table}`],
    );
    if (exists.rows[0]?.exists !== true) {
      snapshots[table] = { exists: false, rowCount: 0, checksum: null };
      continue;
    }
    const result = await client.query(
      `SELECT count(*)::integer AS row_count,
              md5(
                coalesce(
                  string_agg(md5(row_value::text), '' ORDER BY row_id),
                  ''
                )
              ) AS checksum
         FROM (
           SELECT id AS row_id, table_row AS row_value
             FROM public.${table} AS table_row
         ) AS ordered_rows`,
    );
    snapshots[table] = {
      exists: true,
      rowCount: result.rows[0]?.row_count ?? 0,
      checksum: result.rows[0]?.checksum ?? null,
    };
  }
  return snapshots;
}

function normalizePackageTypeCode(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/gu, ' ')
    .toUpperCase();
}

async function inspectPackageTypeData(client, canonicalValues) {
  const sources = {};
  const allSourceValues = new Map();
  for (const table of PACKAGE_TYPE_SOURCE_TABLES) {
    const exists = await client.query(
      'SELECT to_regclass($1) IS NOT NULL AS exists',
      [`public.${table}`],
    );
    if (exists.rows[0]?.exists !== true) {
      sources[table] = { exists: false, snapshotCount: 0, distinctCount: 0 };
      continue;
    }
    const result = await client.query(
      `SELECT normalized_code, min(display_name COLLATE "C") AS display_name,
              count(*)::integer AS snapshot_count
         FROM (
           SELECT
             upper(
               regexp_replace(
                 btrim(container ->> 'packageType'),
                 '[[:space:]]+',
                 ' ',
                 'g'
               )
             ) AS normalized_code,
             regexp_replace(
               btrim(container ->> 'packageType'),
               '[[:space:]]+',
               ' ',
               'g'
             ) AS display_name
           FROM public.${table}
           CROSS JOIN LATERAL jsonb_array_elements(
             CASE
               WHEN jsonb_typeof(payload -> 'containers') = 'array'
                 THEN payload -> 'containers'
               ELSE '[]'::jsonb
             END
           ) AS container
           WHERE container ->> 'packageType' IS NOT NULL
             AND btrim(container ->> 'packageType') <> ''
         ) AS normalized
        GROUP BY normalized_code
        ORDER BY normalized_code`,
    );
    let snapshotCount = 0;
    for (const row of result.rows) {
      const code = normalizePackageTypeCode(row.normalized_code);
      const count = Number(row.snapshot_count ?? 0);
      snapshotCount += count;
      const existing = allSourceValues.get(code);
      allSourceValues.set(code, {
        normalizedCode: code,
        displayName:
          existing?.displayName && existing.displayName < row.display_name
            ? existing.displayName
            : row.display_name,
        snapshotCount: (existing?.snapshotCount ?? 0) + count,
      });
    }
    sources[table] = {
      exists: true,
      snapshotCount,
      distinctCount: result.rows.length,
    };
  }

  const catalogResult = await client.query(
    `SELECT code, display_name, is_active, sort_order
       FROM public.package_types
      ORDER BY sort_order, display_name, id`,
  );
  const catalogByCode = new Map();
  const catalogNormalizedDuplicates = [];
  const nonNormalizedCatalogCodes = [];
  for (const row of catalogResult.rows) {
    const code = normalizePackageTypeCode(row.code);
    if (row.code !== code) nonNormalizedCatalogCodes.push(row.code);
    if (catalogByCode.has(code)) catalogNormalizedDuplicates.push(code);
    else catalogByCode.set(code, row);
  }
  const canonicalExpectations = canonicalValues.map((value) => ({
    code: normalizePackageTypeCode(value.displayName ?? value),
  }));
  const canonicalCodes = canonicalExpectations.map((value) => value.code);
  const unresolved = [...allSourceValues.values()].filter(
    (item) => !catalogByCode.has(item.normalizedCode),
  );
  const missingCanonical = canonicalCodes.filter(
    (code) => !catalogByCode.has(code),
  );

  return {
    sources,
    sourceSnapshotCount: [...allSourceValues.values()].reduce(
      (sum, item) => sum + item.snapshotCount,
      0,
    ),
    sourceDistinctCount: allSourceValues.size,
    catalogCount: catalogResult.rows.length,
    canonicalExpectedCount: canonicalCodes.length,
    canonicalResolvedCount: canonicalCodes.length - missingCanonical.length,
    missingCanonical,
    unresolved,
    catalogNormalizedDuplicates,
    nonNormalizedCatalogCodes,
  };
}

function validateDataPostflight(report) {
  const missingSourceTables = Object.entries(report.sources)
    .filter(([, source]) => !source.exists)
    .map(([table]) => table);
  if (missingSourceTables.length > 0) {
    throw new Error(
      `Package Type source tables are missing: ${missingSourceTables.join(', ')}`,
    );
  }
  if (report.canonicalExpectedCount !== 101) {
    throw new Error(
      'Package Type canonical seed must contain exactly 101 rows',
    );
  }
  if (report.missingCanonical.length > 0) {
    throw new Error(
      `Canonical Package Types are missing: ${report.missingCanonical.join(', ')}`,
    );
  }
  if (report.unresolved.length > 0) {
    throw new Error(
      `Stored Package Type snapshots do not resolve: ${report.unresolved
        .map((item) => item.displayName)
        .join(', ')}`,
    );
  }
  if (report.catalogNormalizedDuplicates.length > 0) {
    throw new Error('Package Type catalog contains normalized duplicate codes');
  }
  if (report.nonNormalizedCatalogCodes.length > 0) {
    throw new Error('Package Type catalog contains non-normalized codes');
  }
}

async function inspectSchema(client) {
  const tableResult = await client.query(
    "SELECT to_regclass('public.package_types') IS NOT NULL AS exists",
  );
  const tableExists = tableResult.rows[0]?.exists === true;
  let columns = [];
  let constraints = [];
  let indexes = [];
  let foreignKeys = [];
  let normalizedDuplicates = [];
  if (tableExists) {
    const columnsResult = await client.query(
      `SELECT column_name AS name, data_type AS type,
              character_maximum_length AS length, is_nullable AS nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'package_types'
        ORDER BY ordinal_position`,
    );
    const constraintsResult = await client.query(
      `SELECT conname AS name, contype AS type, convalidated AS validated,
              pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'public.package_types'::regclass
        ORDER BY conname`,
    );
    const indexesResult = await client.query(
      `SELECT index_class.relname AS name,
              index_info.indisunique AS is_unique,
              index_info.indisvalid AS is_valid,
              pg_get_indexdef(index_info.indexrelid) AS definition
         FROM pg_index AS index_info
         JOIN pg_class AS index_class
           ON index_class.oid = index_info.indexrelid
         JOIN pg_class AS table_class
           ON table_class.oid = index_info.indrelid
         JOIN pg_namespace AS table_namespace
           ON table_namespace.oid = table_class.relnamespace
        WHERE table_namespace.nspname = 'public'
          AND table_class.relname = 'package_types'
        ORDER BY index_class.relname`,
    );
    const foreignKeysResult = await client.query(
      `SELECT conname AS name, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'public.package_types'::regclass AND contype = 'f'
        ORDER BY conname`,
    );
    const duplicatesResult = await client.query(
      `SELECT lower(regexp_replace(btrim(code), '[[:space:]]+', ' ', 'g'))
                AS normalized_code,
              count(*)::integer AS duplicate_count
         FROM public.package_types
        GROUP BY lower(regexp_replace(btrim(code), '[[:space:]]+', ' ', 'g'))
       HAVING count(*) > 1
        ORDER BY normalized_code`,
    );
    columns = columnsResult.rows;
    constraints = constraintsResult.rows;
    indexes = indexesResult.rows;
    foreignKeys = foreignKeysResult.rows;
    normalizedDuplicates = duplicatesResult.rows;
  }
  return {
    tableExists,
    columns,
    constraints,
    indexes,
    foreignKeys,
    normalizedDuplicates,
    documents: await inspectDocumentTables(client),
  };
}

function validatePostflight(report) {
  if (!report.tableExists) throw new Error('package_types table is missing');
  const actualColumns = new Map(
    report.columns.map((column) => [column.name, column]),
  );
  const invalidColumns = [...EXPECTED_COLUMNS].filter(([name, expected]) => {
    const actual = actualColumns.get(name);
    return (
      actual?.type !== expected.type ||
      (actual.length ?? null) !== expected.length ||
      actual.nullable !== 'NO'
    );
  });
  if (invalidColumns.length > 0) {
    throw new Error(
      `package_types columns are missing or incompatible: ${invalidColumns
        .map(([name]) => name)
        .join(', ')}`,
    );
  }
  const requiredConstraints = [
    'package_types_pkey',
    'ck_package_types_code_nonblank',
    'ck_package_types_display_name_nonblank',
    'ck_package_types_sort_order_nonnegative',
  ];
  const constraints = new Map(
    report.constraints.map((item) => [item.name, item]),
  );
  const missingConstraints = requiredConstraints.filter(
    (name) =>
      !constraints.has(name) || constraints.get(name).validated !== true,
  );
  if (missingConstraints.length > 0) {
    throw new Error(
      `Missing Package Type constraints: ${missingConstraints.join(', ')}`,
    );
  }
  const indexes = new Map(report.indexes.map((item) => [item.name, item]));
  const normalizedIndex = indexes.get('uq_package_types_code_normalized');
  if (
    normalizedIndex?.is_unique !== true ||
    normalizedIndex?.is_valid !== true ||
    !/lower/i.test(normalizedIndex?.definition ?? '') ||
    !/regexp_replace/i.test(normalizedIndex?.definition ?? '') ||
    !/btrim/i.test(normalizedIndex?.definition ?? '')
  ) {
    throw new Error('Normalized Package Type code unique index is invalid');
  }
  const activeOrderIndex = indexes.get('idx_package_types_active_sort_order');
  if (
    activeOrderIndex?.is_valid !== true ||
    !/sort_order/i.test(activeOrderIndex?.definition ?? '') ||
    !/display_name/i.test(activeOrderIndex?.definition ?? '') ||
    !/WHERE.*is_active/is.test(activeOrderIndex?.definition ?? '')
  ) {
    throw new Error('Active Package Type ordering index is invalid');
  }
  if (report.foreignKeys.length > 0) {
    throw new Error('package_types must remain independent of other catalogs');
  }
  if (report.normalizedDuplicates.length > 0) {
    throw new Error('package_types contains normalized duplicate codes');
  }
}

function assertDocumentsUnchanged(before, after) {
  const changed = DOCUMENT_TABLES.filter(
    (table) =>
      JSON.stringify(before.documents[table]) !==
      JSON.stringify(after.documents[table]),
  );
  if (changed.length > 0) {
    throw new Error(`Booking document tables changed: ${changed.join(', ')}`);
  }
}

async function inspectReadOnly(client) {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout = '2min'");
    const report = await inspectSchema(client);
    await client.query('ROLLBACK');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function inspectPackageTypeDataReadOnly(client, canonicalValues) {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout = '2min'");
    const report = await inspectPackageTypeData(client, canonicalValues);
    await client.query('ROLLBACK');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function maskHost(host) {
  if (host === 'localhost' || host === '127.0.0.1') return host;
  if (!host) return '(empty)';
  return `${host.slice(0, 2)}***${host.slice(-2)}`;
}

async function runDatabaseMode(args, migrations, canonicalValues) {
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  loadEnvFile(join(PROJECT_ROOT, '.env.local'));
  const config = buildClientConfig();
  const exportEvidence =
    args.mode === 'apply' ? verifyApplyGuards(args, config) : null;
  console.log(
    JSON.stringify(
      {
        mode: args.mode,
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
    const before = await inspectReadOnly(client);
    if (before.tableExists) validatePostflight(before);
    if (args.phase === 'data' && !before.tableExists) {
      throw new Error(
        'Run the Package Type expand migration before data phase',
      );
    }
    const beforeData =
      before.tableExists && args.phase !== 'expand'
        ? await inspectPackageTypeDataReadOnly(client, canonicalValues)
        : null;
    console.log(
      JSON.stringify(
        { preflight: before, packageTypeDataPreflight: beforeData },
        null,
        2,
      ),
    );
    if (args.mode === 'preflight') {
      console.log(
        'Read-only preflight complete; no database writes were made.',
      );
      return;
    }

    const lockResult = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [LOCK_NAME],
    );
    lockAcquired = lockResult.rows[0]?.acquired === true;
    if (!lockAcquired) {
      throw new Error('Another Package Type migration is running');
    }
    await client.query("SET lock_timeout = '5s'");
    await client.query("SET statement_timeout = '5min'");
    await client.query('BEGIN');
    try {
      for (const migration of migrations) {
        await client.query(migration.sql);
      }
      const after = await inspectSchema(client);
      validatePostflight(after);
      assertDocumentsUnchanged(before, after);
      const afterData =
        args.phase !== 'expand'
          ? await inspectPackageTypeData(client, canonicalValues)
          : null;
      if (afterData) validateDataPostflight(afterData);
      await client.query('COMMIT');
      console.log(
        JSON.stringify(
          {
            applied: true,
            phase: args.phase,
            exportEvidence,
            postflight: after,
            packageTypeDataPostflight: afterData,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      await client.query('ROLLBACK');
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selectedPaths = [];
  if (args.phase === 'expand' || args.phase === 'all') {
    selectedPaths.push({ phase: 'expand', path: EXPAND_SQL_PATH });
  }
  if (args.phase === 'data' || args.phase === 'all') {
    selectedPaths.push({ phase: 'data', path: DATA_SQL_PATH });
  }
  const migrations = selectedPaths.map((migration) => {
    if (!existsSync(migration.path)) {
      throw new Error(`Missing Package Type migration: ${migration.path}`);
    }
    const sql = readFileSync(migration.path, 'utf8');
    if (migration.phase === 'expand') verifyStaticMigration(sql);
    else verifyStaticDataMigration(sql);
    return {
      ...migration,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    };
  });
  const dataMigration = migrations.find(
    (migration) => migration.phase === 'data',
  );
  const canonicalValues = dataMigration
    ? verifyStaticDataMigration(dataMigration.sql)
    : [];
  if (args.mode === 'verify') {
    console.log(
      JSON.stringify(
        {
          mode: 'static-dry-run',
          phase: args.phase,
          migrations: migrations.map((migration) => ({
            phase: migration.phase,
            scriptChecksum: migration.checksum,
          })),
          canonicalPackageTypeCount: canonicalValues.length,
          databaseConnectionOpened: false,
          verified: true,
        },
        null,
        2,
      ),
    );
    return;
  }
  await runDatabaseMode(args, migrations, canonicalValues);
}

const isMain =
  process.argv[1] != null &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { inspectPackageTypeData, validateDataPostflight };
