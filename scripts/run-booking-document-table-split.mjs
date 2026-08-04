import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
import {
  SPLIT_TABLES,
  parseBookingDocumentSplitArgs,
  validateBookingDocumentSplitCli,
  validateBookingDocumentSplitPostflight,
  validateBookingDocumentSplitPreflight,
} from './lib/booking-document-table-split-support.mjs';

const root = resolve(import.meta.dirname, '..');
const sqlFile = '2026-08-04_split_booking_document_records.sql';
const confirmationToken = 'DELETE_14_AND_SPLIT_BOOKING_DOCUMENTS_20260804';
const advisoryLockName = 'seatrans:booking-document-table-split:2026-08-04';

function loadEnv(path) {
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

function buildClientConfig() {
  const sslEnabled = [
    'true',
    '1',
    'require',
    'verify-ca',
    'verify-full',
  ].includes(process.env.DB_SSL?.trim().toLowerCase() ?? '');
  const ssl = sslEnabled
    ? {
        rejectUnauthorized:
          process.env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() ===
          'true',
      }
    : undefined;
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

function maskHost(host) {
  if (host === 'localhost' || host === '127.0.0.1') return host;
  if (!host) return '(empty)';
  return host.length < 5
    ? `${host[0]}***`
    : `${host.slice(0, 2)}***${host.slice(-2)}`;
}

async function inspectState(client) {
  const identity = await client.query(`SELECT current_database() AS database`);
  const relationResult = await client.query(
    `SELECT
       to_regclass('public.booking_document_records') IS NOT NULL AS legacy,
       to_regclass('public.booking_records') IS NOT NULL AS booking,
       to_regclass('public.arrival_notice_records') IS NOT NULL AS an,
       to_regclass('public.delivery_order_records') IS NOT NULL AS do,
       to_regclass('public.bill_of_lading_records') IS NOT NULL AS bl`,
  );
  const relations = relationResult.rows[0] ?? {};
  const splitTableExists = {
    booking_records: relations.booking === true,
    arrival_notice_records: relations.an === true,
    delivery_order_records: relations.do === true,
    bill_of_lading_records: relations.bl === true,
  };
  let distribution = null;
  if (relations.legacy === true) {
    const result = await client.query(`
      SELECT
        COUNT(*)::integer AS total,
        COUNT(*) FILTER (WHERE document_type = 'booking')::integer AS booking,
        COUNT(*) FILTER (WHERE document_type = 'an')::integer AS an,
        COUNT(*) FILTER (WHERE document_type = 'do')::integer AS do,
        COUNT(*) FILTER (WHERE document_type = 'bl')::integer AS bl,
        COUNT(*) FILTER (
          WHERE document_type NOT IN ('booking', 'an', 'do', 'bl')
             OR document_type IS NULL
        )::integer AS unknown
      FROM booking_document_records
    `);
    distribution = result.rows[0];
  }

  const splitRowCounts = {};
  for (const table of SPLIT_TABLES) {
    if (splitTableExists[table]) {
      const result = await client.query(
        `SELECT COUNT(*)::integer AS count FROM ${table}`,
      );
      splitRowCounts[table] = result.rows[0]?.count ?? null;
    }
  }

  const generatedResult = await client.query(
    `SELECT table_name AS "tableName", column_name AS "columnName"
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
        AND is_generated = 'ALWAYS'
      ORDER BY table_name, ordinal_position`,
    [SPLIT_TABLES],
  );
  const constraintResult = await client.query(
    `SELECT conname AS name
       FROM pg_constraint
      WHERE conrelid = ANY($1::regclass[])
      ORDER BY conname`,
    [SPLIT_TABLES.filter((table) => splitTableExists[table])],
  );
  const indexResult = await client.query(
    `SELECT indexname AS name
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])
      ORDER BY indexname`,
    [SPLIT_TABLES],
  );
  const childFkResult = await client.query(
    `SELECT c.conname AS name,
            target.relname AS "targetTable",
            c.confdeltype AS "deleteAction"
       FROM pg_constraint c
       JOIN pg_class source ON source.oid = c.conrelid
       JOIN pg_class target ON target.oid = c.confrelid
      WHERE c.contype = 'f'
        AND source.relname = ANY($1::text[])
        AND c.conname LIKE 'fk_%_booking'
      ORDER BY c.conname`,
    [SPLIT_TABLES],
  );
  return {
    database: identity.rows[0]?.database,
    legacyTableExists: relations.legacy === true,
    splitTableExists,
    distribution,
    splitRowCounts,
    generatedColumns: generatedResult.rows,
    constraintNames: constraintResult.rows.map((row) => row.name),
    indexNames: indexResult.rows.map((row) => row.name),
    childBookingForeignKeys: childFkResult.rows,
  };
}

async function inspectReadOnly(client) {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    await client.query(`SET LOCAL statement_timeout = '30s'`);
    const report = await inspectState(client);
    await client.query('ROLLBACK');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  loadEnv(join(root, '.env'));
  loadEnv(join(root, '.env.local'));
  const config = buildClientConfig();
  const args = parseBookingDocumentSplitArgs(process.argv.slice(2));
  validateBookingDocumentSplitCli(args, config.database, confirmationToken);

  console.log(
    JSON.stringify(
      {
        mode: args.mode,
        migration: sqlFile,
        target: {
          host: maskHost(config.host),
          port: config.port,
          database: config.database,
        },
        destructive: true,
        expectedDeletedRows: 14,
      },
      null,
      2,
    ),
  );

  const client = new pg.Client(config);
  await client.connect();
  let lockAcquired = false;
  try {
    const connectedDatabase = await client.query(
      `SELECT current_database() AS database`,
    );
    if (connectedDatabase.rows[0]?.database !== args.targetDb) {
      throw new Error('Connected database does not match --target-db');
    }

    if (args.mode === 'inspect') {
      const report = await inspectReadOnly(client);
      let state = 'invalid';
      try {
        validateBookingDocumentSplitPreflight(report);
        state = 'ready';
      } catch {
        try {
          validateBookingDocumentSplitPostflight(report);
          state = 'applied';
        } catch {
          state = 'invalid';
        }
      }
      console.log(JSON.stringify({ readOnly: true, state, report }, null, 2));
      return;
    }

    if (args.mode === 'dry-run') {
      const report = await inspectReadOnly(client);
      validateBookingDocumentSplitPreflight(report);
      console.log(JSON.stringify({ readOnly: true, ready: true, report }, null, 2));
      console.log(
        `Dry-run only. Apply requires --apply --target-db=${config.database} --confirm=${confirmationToken}`,
      );
      return;
    }

    const lockResult = await client.query(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS acquired`,
      [advisoryLockName],
    );
    lockAcquired = lockResult.rows[0]?.acquired === true;
    if (!lockAcquired) {
      throw new Error('Another booking-document split migration is running');
    }
    await client.query(`SET lock_timeout = '10s'`);
    await client.query(`SET statement_timeout = '5min'`);
    await client.query(`SET idle_in_transaction_session_timeout = '60s'`);
    await client.query('BEGIN');
    try {
      const before = await inspectState(client);
      validateBookingDocumentSplitPreflight(before);
      const sql = readFileSync(
        join(root, 'scripts', 'migrations', sqlFile),
        'utf8',
      );
      await client.query(sql);
      const after = await inspectState(client);
      validateBookingDocumentSplitPostflight(after);
      await client.query('COMMIT');
      console.log(
        JSON.stringify(
          { committed: true, permanentlyDeletedRows: 14, before, after },
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
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [
        advisoryLockName,
      ]);
    }
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
