import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  assertReadOnlySql,
  buildCommodityTypeCodeRemovalPreflight,
  COMMODITY_TYPES_SQL,
  EPDA_PARAMETER_SETS_SQL,
  findShippingAgencyServiceTypeId,
  SERVICE_TYPES_SQL,
  SHIPPING_AGENCY_INQUIRIES_SQL,
} from './lib/commodity-type-code-removal-preflight.mjs';

const PROJECT_ROOT = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const REPORT_SQL = [
  SERVICE_TYPES_SQL,
  COMMODITY_TYPES_SQL,
  SHIPPING_AGENCY_INQUIRIES_SQL,
  EPDA_PARAMETER_SETS_SQL,
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
  const args = { output: null };
  for (const argument of argv) {
    const [key, ...valueParts] = argument.split('=');
    if (key === '--output' && valueParts.length > 0) {
      args.output = resolve(valueParts.join('='));
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return args;
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
  const dbUrl = process.env.DB_URL?.trim();
  const ssl = sslConfig();
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

async function queryRows(client, sql) {
  assertReadOnlySql(sql);
  const result = await client.query(sql);
  return result.rows;
}

async function emitReport(report, outputPath) {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (!outputPath) {
    process.stdout.write(serialized);
    return;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(
    `${JSON.stringify({ output: outputPath, summary: report.summary }, null, 2)}\n`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  loadEnvFile(join(PROJECT_ROOT, '.env.local'));

  REPORT_SQL.forEach(assertReadOnlySql);
  const client = new pg.Client(clientConfig());
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '30s'");

    const serviceTypes = await queryRows(client, SERVICE_TYPES_SQL);
    const shippingAgencyServiceTypeId =
      findShippingAgencyServiceTypeId(serviceTypes);
    const commodityTypes = await queryRows(client, COMMODITY_TYPES_SQL);
    const inquiries = await queryRows(client, SHIPPING_AGENCY_INQUIRIES_SQL);
    const epdaParameterSets = await queryRows(client, EPDA_PARAMETER_SETS_SQL);
    const report = buildCommodityTypeCodeRemovalPreflight({
      commodityTypes,
      inquiries,
      epdaParameterSets,
      shippingAgencyServiceTypeId,
    });
    await emitReport(report, args.output);
  } finally {
    if (transactionOpen) await client.query('ROLLBACK');
    await client.end();
  }
}

function formatError(error) {
  if (error instanceof AggregateError) {
    const nested = [...error.errors]
      .map((item) =>
        item instanceof Error
          ? [item.code, item.message].filter(Boolean).join(': ')
          : String(item),
      )
      .filter(Boolean);
    return nested.length > 0 ? nested.join('; ') : 'AggregateError';
  }
  if (error instanceof Error) {
    return [error.code, error.message].filter(Boolean).join(': ') || error.name;
  }
  return String(error);
}

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});
