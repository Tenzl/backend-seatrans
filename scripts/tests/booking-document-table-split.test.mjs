import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  GENERATED_COLUMNS,
  LEGACY_DISTRIBUTION,
  REQUIRED_CONSTRAINTS,
  REQUIRED_INDEXES,
  SPLIT_TABLES,
  parseBookingDocumentSplitArgs,
  validateBookingDocumentSplitCli,
  validateBookingDocumentSplitPostflight,
  validateBookingDocumentSplitPreflight,
} from '../lib/booking-document-table-split-support.mjs';

function preflightReport(distribution = LEGACY_DISTRIBUTION) {
  return {
    legacyTableExists: true,
    splitTableExists: Object.fromEntries(
      SPLIT_TABLES.map((table) => [table, false]),
    ),
    distribution,
  };
}

function postflightReport() {
  return {
    legacyTableExists: false,
    splitTableExists: Object.fromEntries(
      SPLIT_TABLES.map((table) => [table, true]),
    ),
    splitRowCounts: Object.fromEntries(
      SPLIT_TABLES.map((table) => [table, 0]),
    ),
    generatedColumns: Object.entries(GENERATED_COLUMNS).flatMap(
      ([tableName, columns]) =>
        columns.map((columnName) => ({ tableName, columnName })),
    ),
    constraintNames: REQUIRED_CONSTRAINTS,
    indexNames: REQUIRED_INDEXES,
    childBookingForeignKeys: [
      'arrival_notice_records',
      'delivery_order_records',
      'bill_of_lading_records',
    ].map((table) => ({
      name: `fk_${table}_booking`,
      targetTable: 'booking_records',
      deleteAction: 'c',
    })),
  };
}

test('CLI requires explicit target database and destructive confirmation', () => {
  const token = 'DELETE_14_AND_SPLIT_BOOKING_DOCUMENTS_20260804';
  const args = parseBookingDocumentSplitArgs([
    '--apply',
    '--target-db=seatrans',
    `--confirm=${token}`,
  ]);
  assert.equal(args.mode, 'apply');
  assert.doesNotThrow(() =>
    validateBookingDocumentSplitCli(args, 'seatrans', token),
  );
  assert.throws(
    () => validateBookingDocumentSplitCli(args, 'other_db', token),
    /--target-db/,
  );
  assert.throws(
    () =>
      validateBookingDocumentSplitCli(
        { ...args, confirmation: 'wrong' },
        'seatrans',
        token,
      ),
    /--confirm/,
  );
});

test('preflight accepts only the exact 14-row 5/5/2/2 distribution', () => {
  assert.doesNotThrow(() =>
    validateBookingDocumentSplitPreflight(preflightReport()),
  );
  assert.throws(
    () =>
      validateBookingDocumentSplitPreflight(
        preflightReport({ ...LEGACY_DISTRIBUTION, an: 6, total: 15 }),
      ),
    /destructive guard rejected/,
  );
  assert.throws(
    () =>
      validateBookingDocumentSplitPreflight({
        ...preflightReport(),
        splitTableExists: { booking_records: true },
      }),
    /already exist/,
  );
});

test('postflight requires four empty tables with generated fields and contracts', () => {
  assert.doesNotThrow(() =>
    validateBookingDocumentSplitPostflight(postflightReport()),
  );
  assert.throws(
    () =>
      validateBookingDocumentSplitPostflight({
        ...postflightReport(),
        splitRowCounts: {
          ...postflightReport().splitRowCounts,
          booking_records: 1,
        },
      }),
    /not empty/,
  );
  assert.throws(
    () =>
      validateBookingDocumentSplitPostflight({
        ...postflightReport(),
        generatedColumns: [],
      }),
    /missing generated columns/,
  );
});

test('forward SQL is guarded, creates exactly four business tables, and drops legacy without CASCADE', () => {
  const sql = readFileSync(
    new URL(
      '../migrations/2026-08-04_split_booking_document_records.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const createTables = [...sql.matchAll(/CREATE TABLE\s+([a-z_]+)/gi)].map(
    (match) => match[1],
  );
  assert.deepEqual(createTables, SPLIT_TABLES);
  assert.match(sql, /total_count\s*<>\s*14/i);
  assert.match(sql, /booking_count\s*<>\s*5/i);
  assert.match(sql, /an_count\s*<>\s*5/i);
  assert.match(sql, /do_count\s*<>\s*2/i);
  assert.match(sql, /bl_count\s*<>\s*2/i);
  assert.match(sql, /DROP TABLE booking_document_records;/i);
  assert.doesNotMatch(sql, /DROP TABLE booking_document_records\s+CASCADE/i);
  assert.match(sql, /remaining\s*<>\s*0/i);
});

test('rollback explicitly restores only an empty legacy schema', () => {
  const sql = readFileSync(
    new URL(
      '../migrations/2026-08-04_split_booking_document_records_rollback.sql',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(sql, /DATA IS IRREVERSIBLE/i);
  assert.match(sql, /split_row_count\s*<>\s*0/i);
  assert.match(sql, /CREATE TABLE booking_document_records/i);
  assert.doesNotMatch(sql, /DROP TABLE\s+[a-z_]+\s+CASCADE/i);
});

test('runner uses a read-only dry-run, transaction, lock, and exact token', () => {
  const runner = readFileSync(
    new URL('../run-booking-document-table-split.mjs', import.meta.url),
    'utf8',
  );
  assert.match(runner, /BEGIN TRANSACTION READ ONLY/);
  assert.match(runner, /pg_try_advisory_lock/);
  assert.match(runner, /DELETE_14_AND_SPLIT_BOOKING_DOCUMENTS_20260804/);
  assert.match(runner, /await client\.query\('BEGIN'\)/);
  assert.match(runner, /validateBookingDocumentSplitPostflight/);
});
