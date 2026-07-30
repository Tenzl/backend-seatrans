import {
  chmodSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const SCRIPT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ROOT = resolve(SCRIPT_ROOT);
const MIGRATION_ROOT = join(SCRIPT_ROOT, 'scripts', 'migrations');
const PHASES = ['expand', 'data', 'validate'];
const CONFIRMATION = 'APPLY_EPDA_HARDENING';
const LOCK_NAME = 'seatrans:epda-parameter-hardening:v1';

const SQL_FILES = {
  expand: join(
    MIGRATION_ROOT,
    '2026-07-30_epda_parameter_hardening_expand.sql',
  ),
  data: join(MIGRATION_ROOT, '2026-07-30_epda_parameter_hardening_data.sql'),
  validate: join(
    MIGRATION_ROOT,
    '2026-07-30_epda_parameter_hardening_validate.sql',
  ),
};

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
    phase: 'expand',
    apply: false,
    targetDb: null,
    backupReference: null,
    exportDir: null,
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
    if (key === '--phase') result.phase = value;
    else if (key === '--target-db') result.targetDb = value;
    else if (key === '--backup-reference') result.backupReference = value;
    else if (key === '--export-dir') result.exportDir = value;
    else if (key === '--confirm') result.confirmation = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }

  if (!PHASES.includes(result.phase)) {
    throw new Error(`--phase must be one of: ${PHASES.join(', ')}`);
  }
  return result;
}

function buildSsl() {
  const explicit = process.env.DB_SSL?.trim().toLowerCase();
  const enabled = ['true', '1', 'require', 'verify-ca', 'verify-full'].includes(
    explicit ?? '',
  );
  if (!enabled) return undefined;

  const rejectRaw = (
    process.env.DB_SSL_REJECT_UNAUTHORIZED ?? 'false'
  ).toLowerCase();
  const caPath = process.env.DB_SSL_CA_PATH?.trim();
  if (caPath) {
    const absolute = isAbsolute(caPath)
      ? caPath
      : resolve(PROJECT_ROOT, caPath);
    if (!existsSync(absolute)) {
      throw new Error(`DB_SSL_CA_PATH does not exist: ${absolute}`);
    }
    return {
      rejectUnauthorized: true,
      ca: readFileSync(absolute, 'utf8'),
    };
  }
  return {
    rejectUnauthorized: rejectRaw === 'true' || rejectRaw === '1',
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

function mask(value) {
  if (!value) return '(empty)';
  if (value === 'localhost' || value === '127.0.0.1') return value;
  if (value.length <= 4) return `${value[0]}***`;
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function deepMerge(base, override) {
  if (Array.isArray(override)) return override.map(stableValue);
  if (!override || typeof override !== 'object') return override;
  const result =
    base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(override)) {
    result[key] = deepMerge(result[key], value);
  }
  return result;
}

function assertApplyGuards(args, config) {
  if (!args.apply) return;
  if (!args.targetDb || args.targetDb !== config.database) {
    throw new Error(
      '--target-db must exactly match the configured database name',
    );
  }
  if (!args.backupReference?.trim()) {
    throw new Error(
      '--backup-reference is required and confirms the provider snapshot completed',
    );
  }
  if (args.confirmation !== CONFIRMATION) {
    throw new Error(`--confirm must equal ${CONFIRMATION}`);
  }
  if (!args.exportDir || !isAbsolute(args.exportDir)) {
    throw new Error('--export-dir must be an absolute existing directory');
  }
  const exportDir = realpathSync(args.exportDir);
  if (!statSync(exportDir).isDirectory()) {
    throw new Error('--export-dir must point to a directory');
  }
  const projectRelative = relative(PROJECT_ROOT, exportDir);
  if (
    projectRelative === '' ||
    (!projectRelative.startsWith('..') && !isAbsolute(projectRelative))
  ) {
    throw new Error('--export-dir must be outside backend2.0');
  }
}

async function tableExists(client, tableName) {
  const result = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${tableName}`],
  );
  return result.rows[0]?.exists === true;
}

async function columnExists(client, tableName, columnName) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = $2
     ) AS exists`,
    [tableName, columnName],
  );
  return result.rows[0]?.exists === true;
}

async function collectPreflight(client) {
  const membershipTableExists = await tableExists(
    client,
    'epda_parameter_group_members',
  );
  const versionColumnExists = await columnExists(
    client,
    'epda_parameter_set',
    'version',
  );

  const summaryResult = await client.query(`
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE scope = 'AREA')::integer AS area_count,
      count(*) FILTER (WHERE scope = 'GROUP')::integer AS group_count,
      count(*) FILTER (WHERE scope = 'PORT')::integer AS port_count,
      count(*) FILTER (
        WHERE scope = 'PORT' AND values = '{}'::jsonb
      )::integer AS empty_port_overrides
    FROM epda_parameter_set
  `);

  const anomalyResult = await client.query(`
    WITH checks AS (
      SELECT 'invalid_scope' AS kind, id
      FROM epda_parameter_set
      WHERE scope NOT IN ('AREA', 'GROUP', 'PORT')
      UNION ALL
      SELECT 'invalid_values_type', id
      FROM epda_parameter_set
      WHERE jsonb_typeof(values) IS DISTINCT FROM 'object'
      UNION ALL
      SELECT 'invalid_area_shape', id
      FROM epda_parameter_set
      WHERE scope = 'AREA' AND (
        area NOT IN ('1', '2', '3') OR port_id IS NOT NULL OR name IS NOT NULL
      )
      UNION ALL
      SELECT 'invalid_port_shape', id
      FROM epda_parameter_set
      WHERE scope = 'PORT' AND (port_id IS NULL OR name IS NOT NULL)
      UNION ALL
      SELECT 'invalid_group_shape', id
      FROM epda_parameter_set
      WHERE scope = 'GROUP' AND (
        area NOT IN ('1', '2', '3')
        OR port_id IS NOT NULL
        OR name IS NULL
        OR btrim(name) = ''
      )
      UNION ALL
      SELECT 'invalid_port_area', parameter_set.id
      FROM epda_parameter_set parameter_set
      WHERE parameter_set.scope = 'PORT'
        AND parameter_set.area IS NOT NULL
        AND parameter_set.area NOT IN ('1', '2', '3')
      UNION ALL
      SELECT 'orphan_port_override', parameter_set.id
      FROM epda_parameter_set parameter_set
      LEFT JOIN ports port ON port.id = parameter_set.port_id
      WHERE parameter_set.scope = 'PORT' AND port.id IS NULL
      UNION ALL
      SELECT 'port_area_mismatch', parameter_set.id
      FROM epda_parameter_set parameter_set
      JOIN ports port ON port.id = parameter_set.port_id
      LEFT JOIN provinces province ON province.id = port.province_id
      WHERE parameter_set.scope = 'PORT'
        AND (
          province.area IS NULL
          OR (
            parameter_set.area IS NOT NULL
            AND parameter_set.area IS DISTINCT FROM province.area::text
          )
        )
      UNION ALL
      SELECT 'invalid_group_members_json', id
      FROM epda_parameter_set
      WHERE scope = 'GROUP'
        AND member_port_ids IS NOT NULL
        AND jsonb_typeof(member_port_ids) IS DISTINCT FROM 'array'
      UNION ALL
      SELECT 'duplicate_group_name', min(id)
      FROM epda_parameter_set
      WHERE scope = 'GROUP'
      GROUP BY area, lower(btrim(name))
      HAVING count(*) > 1
      UNION ALL
      SELECT 'orphan_audit_port', log.id
      FROM epda_parameter_change_logs log
      LEFT JOIN ports port ON port.id = log.port_id
      WHERE log.port_id IS NOT NULL AND port.id IS NULL
      UNION ALL
      SELECT 'orphan_audit_user', log.id
      FROM epda_parameter_change_logs log
      LEFT JOIN users app_user ON app_user.id = log.changed_by_user_id
      WHERE log.changed_by_user_id IS NOT NULL AND app_user.id IS NULL
    )
    SELECT kind, array_agg(id ORDER BY id) AS ids
    FROM checks
    GROUP BY kind
    ORDER BY kind
  `);

  const legacyMemberResult = await client.query(`
    WITH legacy_members AS (
      SELECT
        parameter_set.id AS group_id,
        parameter_set.area AS group_area,
        member.value,
        member.ordinality
      FROM epda_parameter_set parameter_set
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(parameter_set.member_port_ids) = 'array'
            THEN parameter_set.member_port_ids
          ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY AS member(value, ordinality)
      WHERE parameter_set.scope = 'GROUP'
    ),
    numeric_members AS (
      SELECT
        group_id,
        group_area,
        CASE
          WHEN jsonb_typeof(value) = 'number'
            AND value::text ~ '^[0-9]+$'
            AND value::text::numeric BETWEEN 1 AND 2147483647
          THEN value::text::integer
          ELSE NULL
        END AS port_id,
        ordinality
      FROM legacy_members
    ),
    checks AS (
      SELECT 'invalid_group_member_value' AS kind, group_id AS id
      FROM numeric_members
      WHERE port_id IS NULL
      UNION ALL
      SELECT 'duplicate_member_in_group', group_id
      FROM numeric_members
      WHERE port_id IS NOT NULL
      GROUP BY group_id, port_id
      HAVING count(*) > 1
      UNION ALL
      SELECT 'port_in_multiple_groups', min(group_id)
      FROM numeric_members
      WHERE port_id IS NOT NULL
      GROUP BY port_id
      HAVING count(DISTINCT group_id) > 1
      UNION ALL
      SELECT 'orphan_group_member', member.group_id
      FROM numeric_members member
      LEFT JOIN ports port ON port.id = member.port_id
      WHERE member.port_id IS NOT NULL AND port.id IS NULL
      UNION ALL
      SELECT 'group_member_area_mismatch', member.group_id
      FROM numeric_members member
      JOIN ports port ON port.id = member.port_id
      LEFT JOIN provinces province ON province.id = port.province_id
      WHERE province.area IS NULL
         OR member.group_area IS DISTINCT FROM province.area::text
    )
    SELECT kind, array_agg(DISTINCT id ORDER BY id) AS ids
    FROM checks
    GROUP BY kind
    ORDER BY kind
  `);

  const normalizedMemberResult = membershipTableExists
    ? await client.query(`
        WITH checks AS (
          SELECT 'normalized_non_group' AS kind, member.group_id AS id
          FROM epda_parameter_group_members member
          JOIN epda_parameter_set parameter_set
            ON parameter_set.id = member.group_id
          WHERE parameter_set.scope <> 'GROUP'
          UNION ALL
          SELECT 'normalized_area_mismatch', member.group_id
          FROM epda_parameter_group_members member
          JOIN epda_parameter_set parameter_set
            ON parameter_set.id = member.group_id
          JOIN ports port ON port.id = member.port_id
          LEFT JOIN provinces province ON province.id = port.province_id
          WHERE province.area IS NULL
             OR parameter_set.area IS DISTINCT FROM province.area::text
        )
        SELECT kind, array_agg(DISTINCT id ORDER BY id) AS ids
        FROM checks
        GROUP BY kind
        ORDER BY kind
      `)
    : { rows: [] };

  const anomalies = [
    ...anomalyResult.rows,
    ...legacyMemberResult.rows,
    ...normalizedMemberResult.rows,
  ].map((row) => ({ kind: row.kind, ids: row.ids.map(Number) }));

  if (versionColumnExists) {
    const invalidVersions = await client.query(`
      SELECT array_agg(id ORDER BY id) AS ids
      FROM epda_parameter_set
      WHERE version IS NULL OR version < 1
    `);
    if ((invalidVersions.rows[0]?.ids ?? []).length > 0) {
      anomalies.push({
        kind: 'invalid_version',
        ids: invalidVersions.rows[0].ids.map(Number),
      });
    }
  }

  return {
    ...summaryResult.rows[0],
    membershipTableExists,
    versionColumnExists,
    anomalies,
  };
}

async function readSourceSnapshot(client) {
  const [sets, logs] = await Promise.all([
    client.query(`
      SELECT id, values
      FROM epda_parameter_set
      ORDER BY id
    `),
    client.query(`
      SELECT id, before_values, after_values
      FROM epda_parameter_change_logs
      ORDER BY id
    `),
  ]);
  const setCanonical = canonicalJson(sets.rows);
  const logCanonical = canonicalJson(logs.rows);
  return {
    sets: sets.rows,
    logs: logs.rows,
    counts: {
      epda_parameter_set: sets.rowCount,
      epda_parameter_change_logs: logs.rowCount,
    },
    checksums: {
      epda_parameter_set: sha256(setCanonical),
      epda_parameter_change_logs: sha256(logCanonical),
    },
  };
}

async function readEffectiveSnapshot(client, membershipMode) {
  const [portResult, setResult] = await Promise.all([
    client.query(`
      SELECT port.id, province.area::text AS area
      FROM ports port
      LEFT JOIN provinces province ON province.id = port.province_id
      ORDER BY port.id
    `),
    client.query(`
      SELECT id, scope, area, port_id, member_port_ids, values
      FROM epda_parameter_set
      ORDER BY id
    `),
  ]);

  let normalizedMembers = [];
  if (membershipMode === 'normalized') {
    if (!(await tableExists(client, 'epda_parameter_group_members'))) {
      throw new Error('Normalized membership table does not exist');
    }
    normalizedMembers = (
      await client.query(`
        SELECT group_id, port_id
        FROM epda_parameter_group_members
        ORDER BY group_id, port_id
      `)
    ).rows;
  }

  const sets = setResult.rows;
  const areaSets = new Map(
    sets
      .filter((row) => row.scope === 'AREA')
      .map((row) => [row.area, row.values]),
  );
  const portSets = new Map(
    sets
      .filter((row) => row.scope === 'PORT')
      .map((row) => [Number(row.port_id), row.values]),
  );
  const groups = sets.filter((row) => row.scope === 'GROUP');
  const groupByPort = new Map();

  if (membershipMode === 'legacy') {
    for (const group of groups) {
      for (const portId of group.member_port_ids ?? []) {
        groupByPort.set(Number(portId), group);
      }
    }
  } else {
    const groupById = new Map(groups.map((group) => [Number(group.id), group]));
    for (const member of normalizedMembers) {
      groupByPort.set(
        Number(member.port_id),
        groupById.get(Number(member.group_id)),
      );
    }
  }

  const effective = portResult.rows.map((port) => {
    const portId = Number(port.id);
    const group = groupByPort.get(portId);
    const areaValues = areaSets.get(port.area) ?? {};
    const groupValues = group?.values ?? {};
    const portValues = portSets.get(portId) ?? {};
    return {
      portId,
      area: port.area,
      values: deepMerge(deepMerge(areaValues, groupValues), portValues),
    };
  });

  return {
    checksum: sha256(canonicalJson(effective)),
    perPort: new Map(
      effective.map((row) => [row.portId, sha256(canonicalJson(row))]),
    ),
  };
}

function assertSameEffective(before, after) {
  const changed = [];
  const ids = new Set([...before.perPort.keys(), ...after.perPort.keys()]);
  for (const id of ids) {
    if (before.perPort.get(id) !== after.perPort.get(id)) changed.push(id);
  }
  if (changed.length > 0 || before.checksum !== after.checksum) {
    throw new Error(
      `Effective EPDA parameters changed for port IDs: ${changed.join(', ')}`,
    );
  }
}

function logicalExport(config, exportDir, phase, snapshot, backupReference) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = `${stamp}_epda_${phase}`;
  const commonArgs = [
    '--host',
    config.host,
    '--port',
    String(config.port),
    '--username',
    config.user,
    '--dbname',
    config.database,
    '--data-only',
    '--column-inserts',
    '--no-owner',
    '--no-privileges',
  ];
  const files = [];

  for (const table of ['epda_parameter_set', 'epda_parameter_change_logs']) {
    const path = join(exportDir, `${prefix}_${table}.sql`);
    const descriptor = openSync(path, 'wx', 0o600);
    const result = spawnSync(
      'pg_dump',
      [...commonArgs, '--table', `public.${table}`],
      {
        env: {
          ...process.env,
          PGPASSWORD: config.password,
          PGSSLMODE: config.ssl ? 'require' : 'disable',
        },
        stdio: ['ignore', descriptor, 'pipe'],
        encoding: 'utf8',
      },
    );
    closeSync(descriptor);
    if (result.status !== 0) {
      unlinkSync(path);
      throw new Error(
        `pg_dump failed for ${table}: ${String(result.stderr).trim()}`,
      );
    }
    chmodSync(path, 0o600);
    files.push({
      table,
      file: path,
      checksum: sha256(readFileSync(path)),
    });
  }

  const manifestPath = join(exportDir, `${prefix}_manifest.json`);
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        phase,
        host: mask(config.host),
        database: mask(config.database),
        backupReference,
        source: {
          counts: snapshot.counts,
          checksums: snapshot.checksums,
        },
        exports: files,
      },
      null,
      2,
    )}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  chmodSync(manifestPath, 0o600);
  return { files, manifestPath };
}

async function acquireLock(client) {
  const result = await client.query(
    `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired`,
    [LOCK_NAME],
  );
  if (!result.rows[0]?.acquired) {
    throw new Error(
      'Another EPDA hardening migration currently holds the lock',
    );
  }
}

async function lockEpdaSourceTables(client, includeMembership) {
  const tables = [
    'epda_parameter_set',
    'epda_parameter_change_logs',
    'ports',
    'provinces',
    'users',
  ];
  if (includeMembership) tables.push('epda_parameter_group_members');
  await client.query(
    `LOCK TABLE ${tables.join(', ')} IN SHARE ROW EXCLUSIVE MODE`,
  );
}

async function releaseLock(client) {
  await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [
    LOCK_NAME,
  ]);
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_data_migrations (
      id              TEXT PRIMARY KEY,
      checksum        TEXT NOT NULL,
      status          TEXT NOT NULL,
      details         JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at    TIMESTAMPTZ
    )
  `);
}

async function assertPhaseDependencies(client, phase) {
  if (phase === 'expand') return;
  const required =
    phase === 'data'
      ? ['2026-07-30_epda_parameter_hardening_expand']
      : [
          '2026-07-30_epda_parameter_hardening_expand',
          '2026-07-30_epda_parameter_hardening_data',
        ];
  const result = await client.query(
    `SELECT id, status
     FROM app_data_migrations
     WHERE id = ANY($1::text[])`,
    [required],
  );
  const completed = new Set(
    result.rows
      .filter((row) => row.status === 'completed')
      .map((row) => row.id),
  );
  const missing = required.filter((id) => !completed.has(id));
  if (missing.length > 0) {
    throw new Error(`Required migration phases are incomplete: ${missing}`);
  }
}

async function beginLedger(client, id, checksum, details) {
  const existing = await client.query(
    `SELECT checksum, status FROM app_data_migrations WHERE id = $1`,
    [id],
  );
  const row = existing.rows[0];
  if (row?.checksum && row.checksum !== checksum) {
    throw new Error(
      `Migration ${id} already exists with a different script checksum`,
    );
  }
  if (row?.status === 'completed') return false;

  await client.query(
    `INSERT INTO app_data_migrations (
       id, checksum, status, details, started_at, completed_at
     )
     VALUES ($1, $2, 'running', $3::jsonb, now(), NULL)
     ON CONFLICT (id) DO UPDATE SET
       status = 'running',
       details = EXCLUDED.details,
       started_at = now(),
       completed_at = NULL`,
    [id, checksum, JSON.stringify(details)],
  );
  return true;
}

async function finishLedger(client, id, status, details) {
  await client.query(
    `UPDATE app_data_migrations
     SET status = $2,
         details = details || $3::jsonb,
         completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE NULL END
     WHERE id = $1`,
    [id, status, JSON.stringify(details)],
  );
}

function splitExpandSql(sql) {
  const concurrentPattern =
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY[\s\S]*?;/gi;
  const concurrentStatements = sql.match(concurrentPattern) ?? [];
  const schemaSql = sql.replace(concurrentPattern, '').trim();
  return { schemaSql, concurrentStatements };
}

async function executeConcurrentIndexes(client, concurrentStatements) {
  for (const statement of concurrentStatements) {
    await client.query(statement);
  }
}

function throwOnAnomalies(preflight, phase) {
  const blocking = [...preflight.anomalies];
  if (phase === 'validate' && preflight.empty_port_overrides > 0) {
    blocking.push({
      kind: 'empty_port_override',
      ids: ['query-required'],
    });
  }
  if (blocking.length > 0) {
    throw new Error(
      `Preflight anomalies require manual review:\n${JSON.stringify(
        blocking,
        null,
        2,
      )}`,
    );
  }
}

async function assertDataPostconditions(
  client,
  before,
  sourceBefore,
  beforeEffective,
) {
  const afterPreflight = await collectPreflight(client);
  throwOnAnomalies(afterPreflight, 'validate');
  if (afterPreflight.area_count !== before.area_count) {
    throw new Error('AREA row count changed unexpectedly');
  }
  if (afterPreflight.group_count !== before.group_count) {
    throw new Error('GROUP row count changed unexpectedly');
  }
  if (
    afterPreflight.port_count !==
    before.port_count - before.empty_port_overrides
  ) {
    throw new Error('PORT row count differs from declared empty cleanup');
  }
  const sourceAfter = await readSourceSnapshot(client);
  if (
    sourceAfter.counts.epda_parameter_set !==
    sourceBefore.counts.epda_parameter_set - before.empty_port_overrides
  ) {
    throw new Error('Parameter-set total differs from declared empty cleanup');
  }
  if (
    sourceAfter.counts.epda_parameter_change_logs !==
    sourceBefore.counts.epda_parameter_change_logs +
      before.empty_port_overrides
  ) {
    throw new Error('Audit row count differs from declared cleanup audit rows');
  }

  const legacyMembershipCount = await client.query(`
    SELECT count(*)::integer AS count
    FROM (
      SELECT DISTINCT parameter_set.id, member.value::text::integer AS port_id
      FROM epda_parameter_set parameter_set
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(parameter_set.member_port_ids) = 'array'
            THEN parameter_set.member_port_ids
          ELSE '[]'::jsonb
        END
      ) AS member(value)
      WHERE parameter_set.scope = 'GROUP'
    ) members
  `);
  const normalizedMembershipCount = await client.query(`
    SELECT count(*)::integer AS count
    FROM epda_parameter_group_members
  `);
  if (
    legacyMembershipCount.rows[0].count !==
    normalizedMembershipCount.rows[0].count
  ) {
    throw new Error('Normalized membership count does not match legacy JSONB');
  }

  const nonNullPortAreas = await client.query(`
    SELECT array_agg(id ORDER BY id) AS ids
    FROM epda_parameter_set
    WHERE scope = 'PORT' AND area IS NOT NULL
  `);
  if ((nonNullPortAreas.rows[0]?.ids ?? []).length > 0) {
    throw new Error(
      `PORT area backfill incomplete: ${nonNullPortAreas.rows[0].ids}`,
    );
  }

  const afterEffective = await readEffectiveSnapshot(client, 'normalized');
  assertSameEffective(beforeEffective, afterEffective);
  return { afterPreflight, afterEffective };
}

async function main() {
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  const args = parseArgs(process.argv.slice(2));
  const config = buildClientConfig();
  assertApplyGuards(args, config);

  const sqlPath = SQL_FILES[args.phase];
  const sql = readFileSync(sqlPath, 'utf8');
  const scriptChecksum = sha256(sql);
  const migrationId = `2026-07-30_epda_parameter_hardening_${args.phase}`;
  const client = new pg.Client(config);
  let locked = false;
  let ledgerStarted = false;

  console.log(
    `[epda-migrate] mode=${args.apply ? 'APPLY' : 'DRY-RUN'} phase=${args.phase} host=${mask(config.host)} db=${mask(config.database)} ssl=${config.ssl ? 'on' : 'off'}`,
  );
  console.log(`[epda-migrate] script_sha256=${scriptChecksum}`);

  try {
    await client.connect();
    await client.query(`SET lock_timeout = '10s'`);
    await client.query(`SET statement_timeout = '5min'`);
    await client.query(`SET idle_in_transaction_session_timeout = '5min'`);
    await acquireLock(client);
    locked = true;

    const preflight = await collectPreflight(client);
    console.log(
      `[epda-migrate] preflight=${JSON.stringify(preflight, null, 2)}`,
    );
    throwOnAnomalies(preflight, args.phase);

    let sourceBefore = await readSourceSnapshot(client);
    console.log(
      `[epda-migrate] source_before=${JSON.stringify(
        {
          counts: sourceBefore.counts,
          checksums: sourceBefore.checksums,
        },
        null,
        2,
      )}`,
    );

    if (!args.apply) {
      if (
        args.phase !== 'expand' &&
        (!preflight.membershipTableExists || !preflight.versionColumnExists)
      ) {
        throw new Error(
          'Expand phase must be applied before dry-running data or validate',
        );
      }
      console.log(
        '[epda-migrate] dry-run complete; no schema or data was changed',
      );
      return;
    }

    if (args.phase === 'expand') {
      await ensureLedger(client);
    } else if (!(await tableExists(client, 'app_data_migrations'))) {
      throw new Error('Expand phase has not created the migration ledger');
    }
    await assertPhaseDependencies(client, args.phase);
    ledgerStarted = await beginLedger(client, migrationId, scriptChecksum, {
      phase: args.phase,
      backupReference: args.backupReference,
      before: {
        counts: sourceBefore.counts,
        checksums: sourceBefore.checksums,
        scopeCounts: preflight,
      },
    });
    if (!ledgerStarted) {
      console.log(
        `[epda-migrate] ${migrationId} already completed with matching checksum`,
      );
      return;
    }

    if (args.phase === 'expand') {
      const { schemaSql, concurrentStatements } = splitExpandSql(sql);
      await client.query('BEGIN');
      let exportResult;
      try {
        await lockEpdaSourceTables(client, false);
        const lockedPreflight = await collectPreflight(client);
        throwOnAnomalies(lockedPreflight, args.phase);
        sourceBefore = await readSourceSnapshot(client);
        exportResult = logicalExport(
          config,
          realpathSync(args.exportDir),
          args.phase,
          sourceBefore,
          args.backupReference,
        );
        if (schemaSql) await client.query(schemaSql);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      console.log(
        `[epda-migrate] logical exports created; manifest=${exportResult.manifestPath}`,
      );
      await executeConcurrentIndexes(client, concurrentStatements);
      const sourceAfter = await readSourceSnapshot(client);
      if (
        sourceAfter.counts.epda_parameter_set !==
          sourceBefore.counts.epda_parameter_set ||
        sourceAfter.counts.epda_parameter_change_logs !==
          sourceBefore.counts.epda_parameter_change_logs
      ) {
        throw new Error('Expand phase unexpectedly changed source row counts');
      }
      await finishLedger(client, migrationId, 'completed', {
        exportManifest: exportResult.manifestPath,
        after: {
          counts: sourceAfter.counts,
          checksums: sourceAfter.checksums,
        },
      });
    } else {
      let exportManifest = null;
      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL lock_timeout = '10s'`);
        await client.query(`SET LOCAL statement_timeout = '5min'`);
        await client.query(
          `SET LOCAL idle_in_transaction_session_timeout = '5min'`,
        );
        await lockEpdaSourceTables(client, true);
        const lockedPreflight = await collectPreflight(client);
        throwOnAnomalies(lockedPreflight, args.phase);
        sourceBefore = await readSourceSnapshot(client);
        const exportResult = logicalExport(
          config,
          realpathSync(args.exportDir),
          args.phase,
          sourceBefore,
          args.backupReference,
        );
        console.log(
          `[epda-migrate] logical exports created; manifest=${exportResult.manifestPath}`,
        );
        exportManifest = exportResult.manifestPath;
        const membershipMode = args.phase === 'data' ? 'legacy' : 'normalized';
        const effectiveBefore = await readEffectiveSnapshot(
          client,
          membershipMode,
        );
        await client.query(sql);

        if (args.phase === 'data') {
          await assertDataPostconditions(
            client,
            lockedPreflight,
            sourceBefore,
            effectiveBefore,
          );
        } else {
          const sourceAfterValidation = await readSourceSnapshot(client);
          if (
            sourceAfterValidation.checksums.epda_parameter_set !==
              sourceBefore.checksums.epda_parameter_set ||
            sourceAfterValidation.checksums.epda_parameter_change_logs !==
              sourceBefore.checksums.epda_parameter_change_logs
          ) {
            throw new Error('Validate phase unexpectedly changed source data');
          }
          const effectiveAfter = await readEffectiveSnapshot(
            client,
            'normalized',
          );
          assertSameEffective(effectiveBefore, effectiveAfter);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

      const sourceAfter = await readSourceSnapshot(client);
      await finishLedger(client, migrationId, 'completed', {
        exportManifest,
        after: {
          counts: sourceAfter.counts,
          checksums: sourceAfter.checksums,
          effectiveChecksum: (await readEffectiveSnapshot(client, 'normalized'))
            .checksum,
        },
      });
    }

    console.log(`[epda-migrate] ${migrationId} completed successfully`);
  } catch (error) {
    if (args.apply && ledgerStarted) {
      try {
        await finishLedger(client, migrationId, 'failed', {
          failedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Preserve the original error; the operator can inspect the DB ledger.
      }
    }
    throw error;
  } finally {
    if (locked) {
      try {
        await releaseLock(client);
      } catch {
        // Connection close also releases the session-level advisory lock.
      }
    }
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[epda-migrate] FAILED: ${error.message}`);
  process.exitCode = 1;
});
