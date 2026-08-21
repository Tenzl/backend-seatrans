import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  BOOKING_PORT_FIELDS,
  planPortSubNames,
} from './lib/ports-sub-name-migration.mjs';

const PROJECT_ROOT = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-08-21_ports_sub_names_expand.sql',
);
const CONFIRMATIONS = {
  expand: 'APPLY_PORT_SUB_NAMES_EXPAND_20260821',
  data: 'APPLY_PORT_SUB_NAMES_DATA_20260821',
};
const MIGRATION_IDS = {
  expand: '2026-08-21_ports_sub_names_expand_v1',
  data: '2026-08-21_ports_sub_names_booking_backfill_v1',
};
const BOOKING_SOURCE_TABLE = 'booking_records';

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
    )
      value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function parseArgs(argv) {
  const args = {
    mode: 'dry-run',
    phase: 'expand',
    targetDb: null,
    backupReference: null,
    logicalExport: null,
    confirmation: null,
  };
  for (const argument of argv) {
    if (argument === '--apply') args.mode = 'apply';
    else if (argument === '--dry-run' || argument === '--preflight')
      args.mode = 'dry-run';
    else {
      const [key, ...parts] = argument.split('=');
      const value = parts.join('=');
      if (key === '--phase' && ['expand', 'data'].includes(value))
        args.phase = value;
      else if (key === '--target-db') args.targetDb = value;
      else if (key === '--backup-reference') args.backupReference = value;
      else if (key === '--logical-export') args.logicalExport = value;
      else if (key === '--confirm') args.confirmation = value;
      else throw new Error(`Unknown or invalid argument: ${argument}`);
    }
  }
  return args;
}

export function verifyExpandSql(sql) {
  const executable = sql.replace(/--.*$/gm, '').trim();
  if (!/^ALTER\s+TABLE\s+public\.ports/i.test(executable)) {
    throw new Error('Expand migration must only alter public.ports');
  }
  for (const column of ['sub_name_1', 'sub_name_2']) {
    if (
      !new RegExp(
        `ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${column}\\s+VARCHAR\\(100\\)`,
        'i',
      ).test(executable)
    ) {
      throw new Error(
        `Expand migration is missing nullable ${column} VARCHAR(100)`,
      );
    }
  }
  if (/\b(?:drop|delete|update|insert|truncate)\b/i.test(executable)) {
    throw new Error(
      'Expand migration contains a destructive or data statement',
    );
  }
  return true;
}

function buildSsl() {
  const enabled = ['true', '1', 'require', 'verify-ca', 'verify-full'].includes(
    process.env.DB_SSL?.trim().toLowerCase() ?? '',
  );
  return enabled
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' }
    : undefined;
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

function validateApply(args, config) {
  if (args.mode !== 'apply') return;
  if (args.targetDb !== config.database) {
    throw new Error('--target-db must exactly match the configured database');
  }
  if (args.confirmation !== CONFIRMATIONS[args.phase]) {
    throw new Error(`--confirm must equal ${CONFIRMATIONS[args.phase]}`);
  }
  if (!args.backupReference?.trim()) {
    throw new Error('--backup-reference is required for --apply');
  }
  if (!args.logicalExport || !isAbsolute(args.logicalExport)) {
    throw new Error(
      '--logical-export must be a new absolute file outside backend2.0',
    );
  }
  const output = resolve(args.logicalExport);
  if (existsSync(output))
    throw new Error('--logical-export must not already exist');
  const projectRelative = relative(PROJECT_ROOT, output);
  if (
    projectRelative === '' ||
    (!projectRelative.startsWith('..') && !isAbsolute(projectRelative))
  ) {
    throw new Error('--logical-export must be outside backend2.0');
  }
}

async function hasSubNameColumns(client) {
  const result = await client.query(`
    SELECT COUNT(*)::int AS count
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'ports'
       AND column_name IN ('sub_name_1', 'sub_name_2')
  `);
  return Number(result.rows[0]?.count ?? 0) === 2;
}

async function readPorts(client, includeSubNames) {
  const aliases = includeSubNames
    ? 'sub_name_1 AS "subName1", sub_name_2 AS "subName2"'
    : 'NULL::text AS "subName1", NULL::text AS "subName2"';
  return (
    await client.query(`
      SELECT id, name, code, type, ${aliases}
        FROM public.ports
       ORDER BY id
    `)
  ).rows;
}

async function readBookingValues(client) {
  const result = await client.query(
    `
      SELECT '${BOOKING_SOURCE_TABLE}'::text AS source_table,
             booking.id,
             field.key,
             field.value
        FROM public.${BOOKING_SOURCE_TABLE} AS booking
        CROSS JOIN LATERAL jsonb_each_text(
          CASE WHEN jsonb_typeof(booking.payload) = 'object'
            THEN booking.payload ELSE '{}'::jsonb END
        ) AS field(key, value)
       WHERE booking.deleted_at IS NULL
         AND field.key = ANY($1::text[])
         AND BTRIM(field.value) <> ''
       ORDER BY booking.id, field.key
    `,
    [BOOKING_PORT_FIELDS],
  );
  return result.rows;
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

async function readLedgerEntry(client, id) {
  const relation = await client.query(
    `SELECT to_regclass('public.app_schema_migrations')::text AS relation`,
  );
  if (!relation.rows[0]?.relation) return null;
  const result = await client.query(
    `SELECT migration_id AS id,
            script_checksum AS checksum,
            status,
            completed_at AS "completedAt"
       FROM public.app_schema_migrations
      WHERE migration_id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

async function writeSucceededLedger(
  client,
  { migrationId, migrationChecksum, args, details },
) {
  await ensureLedger(client);
  await client.query(
    `INSERT INTO public.app_schema_migrations (
       migration_id, script_checksum, status, backup_reference,
       logical_export_reference, details, started_at, completed_at
     ) VALUES ($1, $2, 'SUCCEEDED', $3, $4, $5::jsonb, NOW(), NOW())
     ON CONFLICT (migration_id) DO UPDATE SET
       script_checksum = EXCLUDED.script_checksum,
       status = 'SUCCEEDED',
       backup_reference = EXCLUDED.backup_reference,
       logical_export_reference = EXCLUDED.logical_export_reference,
       details = EXCLUDED.details,
       completed_at = NOW()`,
    [
      migrationId,
      migrationChecksum,
      args.backupReference,
      args.logicalExport,
      JSON.stringify(details),
    ],
  );
}

function checksum(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function writeBackupExclusive(path, payload) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600);
    writeFileSync(descriptor, JSON.stringify(payload, null, 2), 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    // Creating the final hard link is atomic and refuses to overwrite a file
    // created after validateApply's initial existence check.
    linkSync(temporaryPath, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
  if (statSync(path).size === 0) throw new Error('Backup export is empty');
}

async function run() {
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  loadEnvFile(join(PROJECT_ROOT, '.env.local'));
  const args = parseArgs(process.argv.slice(2));
  const config = buildClientConfig();
  validateApply(args, config);
  const sql = readFileSync(SQL_PATH, 'utf8');
  verifyExpandSql(sql);
  const sqlChecksum = createHash('sha256').update(sql).digest('hex');
  const client = new pg.Client(config);
  await client.connect();
  let advisoryLock = false;
  try {
    const identityResult = await client.query(
      'SELECT current_database() AS database, current_user AS username',
    );
    const identity = identityResult.rows[0];
    const columnsReady = await hasSubNameColumns(client);

    if (args.phase === 'expand') {
      const ports = await readPorts(client, columnsReady);
      const report = {
        mode: args.mode,
        phase: args.phase,
        target: identity,
        columnsReady,
        portCount: ports.length,
        portsChecksum: checksum(
          ports.map(({ id, name, code, type }) => ({ id, name, code, type })),
        ),
        sqlChecksum,
      };
      if (args.mode !== 'apply') {
        console.log(JSON.stringify(report, null, 2));
        console.log('READ ONLY dry-run; no writes occurred.');
        return;
      }

      const lock = await client.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
        [MIGRATION_IDS.expand],
      );
      advisoryLock = lock.rows[0]?.acquired === true;
      if (!advisoryLock)
        throw new Error('Another Port sub-name migration is running');
      const lockedColumnsReady = await hasSubNameColumns(client);
      const existingLedger = await readLedgerEntry(
        client,
        MIGRATION_IDS.expand,
      );
      if (existingLedger) {
        if (!lockedColumnsReady)
          throw new Error(
            'Expand ledger exists but sub-name columns are missing',
          );
        if (existingLedger.checksum !== sqlChecksum)
          throw new Error(
            'Expand migration checksum differs from the applied ledger',
          );
        if (existingLedger.status === 'SUCCEEDED') {
          console.log(
            JSON.stringify(
              { ...report, alreadyApplied: true, ledger: existingLedger },
              null,
              2,
            ),
          );
          return;
        }
      }
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      try {
        await client.query("SET LOCAL lock_timeout = '5s'");
        const lockedPorts = await readPorts(client, lockedColumnsReady);
        const lockedReport = {
          ...report,
          columnsReady: lockedColumnsReady,
          portCount: lockedPorts.length,
          portsChecksum: checksum(
            lockedPorts.map(({ id, name, code, type }) => ({
              id,
              name,
              code,
              type,
            })),
          ),
        };
        writeBackupExclusive(args.logicalExport, {
          ...lockedReport,
          backupReference: args.backupReference,
          ports: lockedPorts,
        });
        await client.query(sql);
        if (!(await hasSubNameColumns(client)))
          throw new Error('Expand postflight failed');
        const postflightPorts = await readPorts(client, true);
        const postflightChecksum = checksum(
          postflightPorts.map(({ id, name, code, type }) => ({
            id,
            name,
            code,
            type,
          })),
        );
        if (postflightChecksum !== lockedReport.portsChecksum)
          throw new Error(
            'Expand postflight detected unexpected port data changes',
          );
        await writeSucceededLedger(client, {
          migrationId: MIGRATION_IDS.expand,
          migrationChecksum: sqlChecksum,
          args,
          details: { report: lockedReport, postflightChecksum },
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      console.log(
        JSON.stringify(
          {
            ...report,
            committed: true,
            logicalExport: realpathSync(args.logicalExport),
          },
          null,
          2,
        ),
      );
      return;
    }

    if (!columnsReady) throw new Error('Run and apply the expand phase first');
    const ports = await readPorts(client, true);
    const bookingRows = await readBookingValues(client);
    const plan = planPortSubNames({
      ports,
      bookingValues: bookingRows.map((row) => row.value),
    });
    const report = {
      mode: args.mode,
      phase: args.phase,
      target: identity,
      bookingValueCount: bookingRows.length,
      updateCount: plan.updates.length,
      plan,
      bookingTextChecksum: checksum(bookingRows),
    };
    if (args.mode !== 'apply') {
      console.log(JSON.stringify(report, null, 2));
      console.log('READ ONLY dry-run; no writes occurred.');
      return;
    }

    const lock = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [MIGRATION_IDS.data],
    );
    advisoryLock = lock.rows[0]?.acquired === true;
    if (!advisoryLock)
      throw new Error('Another Port sub-name migration is running');
    const existingLedger = await readLedgerEntry(client, MIGRATION_IDS.data);
    if (existingLedger) {
      const plannedChecksum = checksum(plan);
      if (
        existingLedger.status === 'SUCCEEDED' &&
        existingLedger.checksum !== plannedChecksum
      ) {
        // A successful data migration naturally produces an empty plan on a
        // rerun because the aliases are now known. Keep the original ledger.
        if (plan.updates.length !== 0)
          throw new Error(
            'Data migration checksum differs from the applied ledger',
          );
      }
      if (existingLedger.status === 'SUCCEEDED') {
        console.log(
          JSON.stringify(
            { ...report, alreadyApplied: true, ledger: existingLedger },
            null,
            2,
          ),
        );
        return;
      }
    }
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query('LOCK TABLE public.ports IN SHARE ROW EXCLUSIVE MODE');
      const lockedPorts = await readPorts(client, true);
      const lockedBookings = await readBookingValues(client);
      const lockedPlan = planPortSubNames({
        ports: lockedPorts,
        bookingValues: lockedBookings.map((row) => row.value),
      });
      if (checksum(lockedPlan) !== checksum(plan))
        throw new Error(
          'Migration plan changed after locking; retry from dry-run',
        );
      const lockedReport = {
        ...report,
        bookingValueCount: lockedBookings.length,
        updateCount: lockedPlan.updates.length,
        plan: lockedPlan,
        bookingTextChecksum: checksum(lockedBookings),
      };
      writeBackupExclusive(args.logicalExport, {
        ...lockedReport,
        backupReference: args.backupReference,
        affectedPorts: lockedPorts.filter((port) =>
          lockedPlan.updates.some((update) => update.id === Number(port.id)),
        ),
      });
      for (const update of lockedPlan.updates) {
        const result = await client.query(
          `UPDATE public.ports SET sub_name_1 = $2, sub_name_2 = $3, updated_at = NOW()
            WHERE id = $1 AND UPPER(BTRIM(code)) = $4`,
          [update.id, update.subName1, update.subName2, update.code],
        );
        if (result.rowCount !== 1)
          throw new Error(
            `Expected one updated port for ${update.code}, got ${result.rowCount}`,
          );
      }
      const postflightPorts = await readPorts(client, true);
      const postflightById = new Map(
        postflightPorts.map((port) => [Number(port.id), port]),
      );
      for (const update of lockedPlan.updates) {
        const saved = postflightById.get(update.id);
        if (
          saved?.subName1 !== update.subName1 ||
          saved?.subName2 !== update.subName2
        ) {
          throw new Error(
            `Data postflight failed for port ${update.id} (${update.code})`,
          );
        }
      }
      await writeSucceededLedger(client, {
        migrationId: MIGRATION_IDS.data,
        migrationChecksum: checksum(lockedPlan),
        args,
        details: { report: lockedReport },
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    console.log(
      JSON.stringify(
        {
          ...report,
          committed: true,
          logicalExport: realpathSync(args.logicalExport),
        },
        null,
        2,
      ),
    );
  } finally {
    if (advisoryLock)
      await client
        .query('SELECT pg_advisory_unlock(hashtext($1))', [
          MIGRATION_IDS[args.phase],
        ])
        .catch(() => undefined);
    await client.end();
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
