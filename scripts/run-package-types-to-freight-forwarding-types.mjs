import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const PROJECT_ROOT = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const DATA_SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-08-20_package_types_to_freight_forwarding_types.sql',
);
const CONTRACT_SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-08-20_drop_package_types.sql',
);
const DATA_CONFIRMATION =
  'APPLY_PACKAGE_TYPES_TO_FREIGHT_FORWARDING_TYPES_20260820';
const CONTRACT_CONFIRMATION = 'DROP_LEGACY_PACKAGE_TYPES_20260820';
const ADVISORY_LOCK_KEY = 208202026;
const EXPECTED_PACKAGE_TYPE_COUNT = 101;

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/gu, ' ');
}

function comparisonKey(value) {
  return normalizeName(value).toLocaleLowerCase('en-US');
}

function serviceSlug(value) {
  return normalizeName(value)
    .replace(/[^a-z0-9]+/giu, '-')
    .replace(/^-|-$/gu, '')
    .toLocaleLowerCase('en-US');
}

export function mergePackageTypesFixture({
  serviceTypes,
  commodityTypes,
  packageTypes,
}) {
  const freightForwardingRows = serviceTypes.filter(
    (row) =>
      serviceSlug(row.name) === 'freight-forwarding' ||
      serviceSlug(row.displayName) === 'freight-forwarding',
  );
  if (freightForwardingRows.length !== 1) {
    throw new Error(
      `Expected exactly one Freight Forwarding Service, found ${freightForwardingRows.length}`,
    );
  }
  const freightForwardingServiceTypeId = freightForwardingRows[0].id;
  const scoped = commodityTypes.filter(
    (row) => row.serviceTypeId === freightForwardingServiceTypeId,
  );
  const removedLegacyPalletsCount = scoped.filter(
    (row) => comparisonKey(row.name) === 'pallets',
  ).length;
  const existing = scoped.filter(
    (row) => comparisonKey(row.name) !== 'pallets',
  );
  const seen = new Set(existing.map((row) => comparisonKey(row.name)));
  const insertedNames = [];
  for (const row of [...packageTypes].sort((a, b) => a.id - b.id)) {
    const name = normalizeName(row.displayName);
    const key = comparisonKey(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    insertedNames.push(name);
  }
  const freightForwardingTypeNames = [
    ...existing.map((row) => normalizeName(row.name)),
    ...insertedNames,
  ].sort((a, b) => a.localeCompare(b, 'en-US', { sensitivity: 'base' }));
  return {
    freightForwardingServiceTypeId,
    removedLegacyPalletsCount,
    insertedNames,
    freightForwardingTypeNames,
  };
}

export function validateMergePostflight(report) {
  if (report.packageTypeCount < 1) {
    throw new Error('Legacy Package Type catalog is empty');
  }
  if (report.packageTypeCount !== EXPECTED_PACKAGE_TYPE_COUNT) {
    throw new Error(
      `Expected exactly ${EXPECTED_PACKAGE_TYPE_COUNT} legacy Package Types, found ${report.packageTypeCount}`,
    );
  }
  if (report.resolvedPackageTypeCount !== report.packageTypeCount) {
    throw new Error(
      `Package Types do not resolve in Freight Forwarding Types: ${report.unresolvedNames.join(', ')}`,
    );
  }
  if (report.normalizedDuplicateNames.length > 0) {
    throw new Error(
      `Freight Forwarding Types contain normalized duplicates: ${report.normalizedDuplicateNames.join(', ')}`,
    );
  }
  if (report.legacyPalletsCount !== 0) {
    throw new Error(
      `Legacy PALLETS Type still exists: ${report.legacyPalletsCount}`,
    );
  }
  if (report.freightForwardingTypeCount !== report.packageTypeCount) {
    throw new Error(
      `Freight Forwarding Type count ${report.freightForwardingTypeCount} does not match Package Type count ${report.packageTypeCount}`,
    );
  }
}

export function validateContractedPostflight(report) {
  if (report.packageTypesExists) {
    throw new Error('Legacy package_types table still exists');
  }
  if (report.freightForwardingTypeCount !== EXPECTED_PACKAGE_TYPE_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_PACKAGE_TYPE_COUNT} Freight Forwarding Types after contract, found ${report.freightForwardingTypeCount}`,
    );
  }
  if (report.normalizedDuplicateNames.length > 0) {
    throw new Error(
      `Freight Forwarding Types contain normalized duplicates: ${report.normalizedDuplicateNames.join(', ')}`,
    );
  }
  if (
    report.legacyPalletsCount !== 0 ||
    report.legacyPalletSnapshotCount !== 0
  ) {
    throw new Error('Legacy PALLETS data still exists after contract');
  }
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
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

function sslConfig() {
  const enabled = ['true', '1', 'require', 'verify-ca', 'verify-full'].includes(
    process.env.DB_SSL?.trim().toLowerCase() ?? '',
  );
  if (!enabled) return undefined;
  return {
    rejectUnauthorized:
      process.env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() === 'true',
  };
}

function clientConfig() {
  const ssl = sslConfig();
  const dbUrl = process.env.DB_URL?.trim();
  if (dbUrl) {
    const parsed = new URL(dbUrl);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 5432,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//u, ''),
      ssl,
      connectionTimeoutMillis: Number(
        process.env.DB_CONNECTION_TIMEOUT_MS ?? 15000,
      ),
    };
  }
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl,
    connectionTimeoutMillis: Number(
      process.env.DB_CONNECTION_TIMEOUT_MS ?? 15000,
    ),
  };
}

function parseArgs(argv) {
  const value = (name) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  return {
    apply: argv.includes('--apply'),
    phase: value('phase') ?? 'data',
    targetDb: value('target-db'),
    backupReference: value('backup-reference'),
    logicalExport: value('logical-export'),
    restoreTestReference: value('restore-test-reference'),
    rollForwardTestReference: value('roll-forward-test-reference'),
    confirm: value('confirm'),
  };
}

function requireEvidencePath(path, label) {
  if (!path || !isAbsolute(path) || !existsSync(path)) {
    throw new Error(`${label} must be an existing absolute path`);
  }
  const resolvedPath = realpathSync(path);
  if (statSync(resolvedPath).size < 1) {
    throw new Error(`${label} must not be empty`);
  }
  const insideProject = relative(PROJECT_ROOT, resolvedPath);
  if (!insideProject.startsWith('..') && !isAbsolute(insideProject)) {
    throw new Error(`${label} must be stored outside backend2.0`);
  }
  return resolvedPath;
}

function validateApplyGuards(args, database) {
  if (!args.apply) return;
  if (!args.targetDb || args.targetDb !== database) {
    throw new Error(`--target-db must exactly match ${database}`);
  }
  requireEvidencePath(args.backupReference, 'backup-reference');
  requireEvidencePath(args.logicalExport, 'logical-export');
  if (!args.restoreTestReference?.trim()) {
    throw new Error('--restore-test-reference is required');
  }
  if (!args.rollForwardTestReference?.trim()) {
    throw new Error('--roll-forward-test-reference is required');
  }
  const expected =
    args.phase === 'data' ? DATA_CONFIRMATION : CONTRACT_CONFIRMATION;
  if (args.confirm !== expected) {
    throw new Error(`--confirm must equal ${expected}`);
  }
}

function checksum(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function relationExists(client, relationName) {
  const result = await client.query(
    'SELECT to_regclass($1) IS NOT NULL AS exists',
    [`public.${relationName}`],
  );
  return result.rows[0]?.exists === true;
}

async function inspectMerge(client) {
  const [packageTypesExists, commodityTypesExists] = await Promise.all([
    relationExists(client, 'package_types'),
    relationExists(client, 'commodity_types'),
  ]);
  if (!commodityTypesExists)
    throw new Error('commodity_types table is missing');
  if (!packageTypesExists) {
    const contracted = await client.query(`
      WITH freight_forwarding AS (
        SELECT service_type.id
          FROM public.service_types service_type
         WHERE upper(regexp_replace(btrim(coalesce(service_type.name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
            OR upper(regexp_replace(btrim(coalesce(service_type.display_name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
      ), freight_types AS (
        SELECT lower(regexp_replace(btrim(type.name), '[[:space:]]+', ' ', 'g')) AS normalized_name
          FROM public.commodity_types type
          JOIN freight_forwarding service_type ON service_type.id = type.service_type_id
      ), duplicate_names AS (
        SELECT normalized_name FROM freight_types GROUP BY normalized_name HAVING count(*) > 1
      )
      SELECT
        (SELECT count(*)::integer FROM freight_types) AS "freightForwardingTypeCount",
        (SELECT count(*)::integer FROM freight_types WHERE normalized_name = 'pallets') AS "legacyPalletsCount",
        coalesce((SELECT json_agg(normalized_name ORDER BY normalized_name) FROM duplicate_names), '[]'::json) AS "normalizedDuplicateNames",
        (
          SELECT sum(reference_count)::integer
            FROM (
              SELECT count(*) AS reference_count FROM public.booking_records
               WHERE lower(regexp_replace(btrim(coalesce(payload ->> 'commodityType', '')), '[[:space:]]+', ' ', 'g')) = 'pallets'
              UNION ALL
              SELECT count(*) FROM public.arrival_notice_records
               WHERE lower(regexp_replace(btrim(coalesce(payload ->> 'commodityType', '')), '[[:space:]]+', ' ', 'g')) = 'pallets'
              UNION ALL
              SELECT count(*) FROM public.delivery_order_records
               WHERE lower(regexp_replace(btrim(coalesce(payload ->> 'commodityType', '')), '[[:space:]]+', ' ', 'g')) = 'pallets'
              UNION ALL
              SELECT count(*) FROM public.bill_of_lading_records
               WHERE lower(regexp_replace(btrim(coalesce(payload ->> 'commodityType', '')), '[[:space:]]+', ' ', 'g')) = 'pallets'
            ) references_by_table
        ) AS "legacyPalletSnapshotCount"
    `);
    return {
      packageTypesExists: false,
      packageTypeCount: 0,
      resolvedPackageTypeCount: 0,
      unresolvedNames: [],
      ...contracted.rows[0],
    };
  }
  const result = await client.query(`
    WITH freight_forwarding AS (
      SELECT service_type.id
        FROM public.service_types service_type
       WHERE upper(regexp_replace(btrim(coalesce(service_type.name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
          OR upper(regexp_replace(btrim(coalesce(service_type.display_name, '')), '[^A-Z0-9]+', '_', 'g')) = 'FREIGHT_FORWARDING'
    ), package_source AS (
      SELECT DISTINCT lower(regexp_replace(btrim(display_name), '[[:space:]]+', ' ', 'g')) AS normalized_name,
             min(regexp_replace(btrim(display_name), '[[:space:]]+', ' ', 'g')) AS display_name
        FROM public.package_types
       WHERE btrim(display_name) <> ''
       GROUP BY lower(regexp_replace(btrim(display_name), '[[:space:]]+', ' ', 'g'))
    ), freight_types AS (
      SELECT type.id,
             lower(regexp_replace(btrim(type.name), '[[:space:]]+', ' ', 'g')) AS normalized_name
        FROM public.commodity_types type
        JOIN freight_forwarding service_type ON service_type.id = type.service_type_id
    ), duplicate_names AS (
      SELECT normalized_name
        FROM freight_types
       GROUP BY normalized_name
      HAVING count(*) > 1
    )
    SELECT
      (SELECT count(*)::integer FROM package_source) AS "packageTypeCount",
      (SELECT count(*)::integer FROM package_source source WHERE EXISTS (
        SELECT 1 FROM freight_types type WHERE type.normalized_name = source.normalized_name
      )) AS "resolvedPackageTypeCount",
      coalesce((SELECT json_agg(source.display_name ORDER BY source.display_name)
        FROM package_source source WHERE NOT EXISTS (
          SELECT 1 FROM freight_types type WHERE type.normalized_name = source.normalized_name
        )), '[]'::json) AS "unresolvedNames",
      coalesce((SELECT json_agg(normalized_name ORDER BY normalized_name) FROM duplicate_names), '[]'::json) AS "normalizedDuplicateNames",
      (SELECT count(*)::integer FROM freight_types) AS "freightForwardingTypeCount",
      (SELECT count(*)::integer FROM freight_types WHERE normalized_name = 'pallets') AS "legacyPalletsCount",
      (
        SELECT sum(reference_count)::integer
          FROM (
            SELECT count(*) AS reference_count FROM public.booking_records
             WHERE lower(regexp_replace(btrim(coalesce(payload ->> 'commodityType', '')), '[[:space:]]+', ' ', 'g')) = 'pallets'
            UNION ALL
            SELECT count(*) FROM public.arrival_notice_records
             WHERE lower(regexp_replace(btrim(coalesce(payload ->> 'commodityType', '')), '[[:space:]]+', ' ', 'g')) = 'pallets'
            UNION ALL
            SELECT count(*) FROM public.delivery_order_records
             WHERE lower(regexp_replace(btrim(coalesce(payload ->> 'commodityType', '')), '[[:space:]]+', ' ', 'g')) = 'pallets'
            UNION ALL
            SELECT count(*) FROM public.bill_of_lading_records
             WHERE lower(regexp_replace(btrim(coalesce(payload ->> 'commodityType', '')), '[[:space:]]+', ' ', 'g')) = 'pallets'
          ) references_by_table
      ) AS "legacyPalletSnapshotCount"
  `);
  return { packageTypesExists: true, ...result.rows[0] };
}

async function documentChecksums(client) {
  const tables = [
    'booking_records',
    'arrival_notice_records',
    'delivery_order_records',
    'bill_of_lading_records',
  ];
  const output = {};
  for (const table of tables) {
    const result = await client.query(
      `SELECT md5(coalesce(string_agg(id::text || ':' || payload::text, '|' ORDER BY id), '')) AS checksum FROM public.${table}`,
    );
    output[table] = result.rows[0]?.checksum;
  }
  return output;
}

async function cargoChecksums(client) {
  const definitions = {
    booking_records: "payload -> 'cargoVolumes'",
    arrival_notice_records: "payload -> 'containers'",
    delivery_order_records: "payload -> 'containers'",
    bill_of_lading_records: "payload -> 'containers'",
  };
  const output = {};
  for (const [table, expression] of Object.entries(definitions)) {
    const result = await client.query(
      `SELECT md5(coalesce(string_agg(id::text || ':' || coalesce((${expression})::text, 'null'), '|' ORDER BY id), '')) AS checksum FROM public.${table}`,
    );
    output[table] = result.rows[0]?.checksum;
  }
  return output;
}

async function run() {
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  const args = parseArgs(process.argv.slice(2));
  if (!['data', 'contract'].includes(args.phase)) {
    throw new Error('--phase must be data or contract');
  }
  const config = clientConfig();
  validateApplyGuards(args, config.database);
  const sqlPath = args.phase === 'data' ? DATA_SQL_PATH : CONTRACT_SQL_PATH;
  const sql = readFileSync(sqlPath, 'utf8');
  const client = new pg.Client(config);
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const before = await inspectMerge(client);
    const checksumsBefore = await documentChecksums(client);
    const cargoChecksumsBefore = await cargoChecksums(client);
    if (args.phase === 'data') {
      if (!before.packageTypesExists) {
        throw new Error('package_types table is missing before data migration');
      }
      const lock = await client.query(
        'SELECT pg_try_advisory_xact_lock($1) AS locked',
        [ADVISORY_LOCK_KEY],
      );
      if (lock.rows[0]?.locked !== true) {
        throw new Error('Another Package Type merge migration is running');
      }
      await client.query(sql);
      const after = await inspectMerge(client);
      validateMergePostflight(after);
      if (after.legacyPalletSnapshotCount !== 0) {
        throw new Error(
          `Legacy PALLETS snapshots still exist: ${after.legacyPalletSnapshotCount}`,
        );
      }
      const checksumsAfter = await documentChecksums(client);
      const cargoChecksumsAfter = await cargoChecksums(client);
      if (
        JSON.stringify(cargoChecksumsBefore) !==
        JSON.stringify(cargoChecksumsAfter)
      ) {
        throw new Error('Booking-document cargo data changed');
      }
      console.log(
        JSON.stringify(
          {
            mode: args.apply ? 'apply' : 'dry-run',
            phase: args.phase,
            target: { database: config.database },
            sqlSha256: checksum(sql),
            before,
            after,
            documentChecksums: checksumsAfter,
            cargoChecksums: cargoChecksumsAfter,
          },
          null,
          2,
        ),
      );
    } else {
      if (before.packageTypesExists) validateMergePostflight(before);
      else validateContractedPostflight(before);
      const lock = await client.query(
        'SELECT pg_try_advisory_xact_lock($1) AS locked',
        [ADVISORY_LOCK_KEY],
      );
      if (lock.rows[0]?.locked !== true) {
        throw new Error('Another Package Type contract migration is running');
      }
      await client.query(sql);
      const tableExistsAfter = await relationExists(client, 'package_types');
      if (tableExistsAfter) {
        throw new Error('package_types still exists after contract migration');
      }
      const after = await inspectMerge(client);
      validateContractedPostflight(after);
      const checksumsAfter = await documentChecksums(client);
      const cargoChecksumsAfter = await cargoChecksums(client);
      if (JSON.stringify(checksumsBefore) !== JSON.stringify(checksumsAfter)) {
        throw new Error('Booking-document payload checksums changed');
      }
      if (
        JSON.stringify(cargoChecksumsBefore) !==
        JSON.stringify(cargoChecksumsAfter)
      ) {
        throw new Error('Booking-document cargo data changed');
      }
      console.log(
        JSON.stringify(
          {
            mode: args.apply ? 'apply' : 'dry-run',
            phase: args.phase,
            target: { database: config.database },
            sqlSha256: checksum(sql),
            before,
            after,
            tableExistsAfter,
            documentChecksums: checksumsAfter,
            cargoChecksums: cargoChecksumsAfter,
          },
          null,
          2,
        ),
      );
    }
    if (args.apply) await client.query('COMMIT');
    else await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

const isMain =
  process.argv[1] &&
  pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;

if (isMain) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
