import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const PROJECT_ROOT = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const FORMAT = 'seatrans-commodity-catalog-backup-v1';
const CONFIRMATION = 'CREATE_COMMODITY_CATALOG_BACKUP_20260819';
const TABLES = [
  'service_types',
  'cargo_types',
  'commodity_groups',
  'commodities',
  'commodity_types',
  'gallery_images',
  'shipping_agency_inquiries',
  'epda_parameter_set',
  'booking_records',
  'arrival_notice_records',
  'delivery_order_records',
  'bill_of_lading_records',
  'package_types',
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
      database: parsed.pathname.replace(/^\//, ''),
      ssl,
      connectionTimeoutMillis: Number(
        process.env.DB_CONNECTION_TIMEOUT_MS ?? 15000,
      ),
    };
  }
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'seatrans',
    ssl,
    connectionTimeoutMillis: Number(
      process.env.DB_CONNECTION_TIMEOUT_MS ?? 15000,
    ),
  };
}

export function checksumSnapshot(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export function parseArgs(argv) {
  const result = {
    output: null,
    targetDb: null,
    confirmation: null,
    restoreTestReference: null,
  };
  for (const argument of argv) {
    const [key, ...parts] = argument.split('=');
    const value = parts.join('=');
    if (key === '--output') result.output = value;
    else if (key === '--target-db') result.targetDb = value;
    else if (key === '--confirm') result.confirmation = value;
    else if (key === '--restore-test-reference') {
      result.restoreTestReference = value;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

export function verifyGuards(args, config) {
  if (!args.targetDb || args.targetDb !== config.database) {
    throw new Error('--target-db must exactly match the configured database');
  }
  if (args.confirmation !== CONFIRMATION) {
    throw new Error(`--confirm must equal ${CONFIRMATION}`);
  }
  if (!args.restoreTestReference?.trim()) {
    throw new Error('--restore-test-reference is required');
  }
  if (!args.output || !isAbsolute(args.output)) {
    throw new Error('--output must be an absolute path');
  }
  const output = resolve(args.output);
  const projectRelative = relative(PROJECT_ROOT, output);
  if (
    projectRelative === '' ||
    (!projectRelative.startsWith('..') && !isAbsolute(projectRelative))
  ) {
    throw new Error('--output must be stored outside backend2.0');
  }
  if (
    !existsSync(dirname(output)) ||
    !statSync(dirname(output)).isDirectory()
  ) {
    throw new Error('--output parent directory must exist');
  }
  if (existsSync(output))
    throw new Error('--output refuses to overwrite a file');
  return output;
}

async function tableSnapshot(client, tableName) {
  const exists = (
    await client.query('SELECT to_regclass($1) IS NOT NULL AS exists', [
      `public.${tableName}`,
    ])
  ).rows[0]?.exists;
  if (!exists)
    return {
      exists: false,
      columns: [],
      constraints: [],
      indexes: [],
      rows: [],
    };

  const columns = (
    await client.query(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [tableName],
    )
  ).rows;
  const constraints = (
    await client.query(
      `SELECT conname, contype, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = $1::regclass
        ORDER BY conname`,
      [`public.${tableName}`],
    )
  ).rows;
  const indexes = (
    await client.query(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1
        ORDER BY indexname`,
      [tableName],
    )
  ).rows;
  const rows = (
    await client.query(`SELECT to_jsonb(t) AS row FROM public."${tableName}" t`)
  ).rows.map((item) => item.row);
  rows.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
  return { exists: true, columns, constraints, indexes, rows };
}

export function readAndVerifyBackup(path) {
  const envelope = JSON.parse(readFileSync(realpathSync(path), 'utf8'));
  if (envelope.format !== FORMAT)
    throw new Error('Backup format is unsupported');
  if (checksumSnapshot(envelope.snapshot) !== envelope.checksum) {
    throw new Error('Backup checksum mismatch');
  }
  if (!envelope.evidence?.restoreTestReference) {
    throw new Error('Backup restore-test reference is missing');
  }
  return envelope;
}

async function main() {
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  loadEnvFile(join(PROJECT_ROOT, '.env.local'));
  const config = clientConfig();
  const args = parseArgs(process.argv.slice(2));
  const output = verifyGuards(args, config);
  const client = new pg.Client(config);
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '60s'");
    const identity = (
      await client.query(
        `SELECT current_database() AS database,
                current_user AS "user",
                current_setting('server_version') AS "serverVersion"`,
      )
    ).rows[0];
    if (identity.database !== args.targetDb) {
      throw new Error('Connected database does not match --target-db');
    }
    const tables = {};
    for (const tableName of TABLES) {
      tables[tableName] = await tableSnapshot(client, tableName);
    }
    const snapshot = { identity, tables };
    const envelope = {
      format: FORMAT,
      createdAt: new Date().toISOString(),
      target: { database: identity.database, host: config.host },
      scope: TABLES,
      checksum: checksumSnapshot(snapshot),
      snapshot,
      evidence: {
        restoreTestReference: args.restoreTestReference.trim(),
        restoreProcedure:
          'Restore affected tables and schema metadata into a copy, verify the envelope checksum, then replay forward migrations.',
      },
    };
    writeFileSync(output, `${JSON.stringify(envelope, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    const verified = readAndVerifyBackup(output);
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: 'read-only-backup',
          target: {
            database: identity.database,
            host: String(config.host).replace(/^(.{2}).*(.{2})$/, '$1***$2'),
          },
          output,
          checksum: verified.checksum,
          tables: Object.fromEntries(
            Object.entries(tables).map(([name, value]) => [
              name,
              { exists: value.exists, rows: value.rows.length },
            ]),
          ),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    if (transactionOpen) await client.query('ROLLBACK');
    await client.end();
  }
}

const isMain =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
