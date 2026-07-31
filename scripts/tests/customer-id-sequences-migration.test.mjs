import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  validateCustomerIdSequencePostflight,
  validateCustomerIdSequencePreflight,
} from '../lib/customer-id-sequence-migration-support.mjs';

const validReport = {
  tableExists: true,
  columns: [
    {
      name: 'sequence_date',
      dataType: 'character',
      length: 6,
      nullable: 'NO',
    },
    {
      name: 'current_value',
      dataType: 'bigint',
      length: null,
      nullable: 'NO',
    },
  ],
  unexpectedColumns: [],
  invalidRows: [],
  duplicateDates: [],
  constraintConflicts: [],
  primaryKeyCovered: true,
  dateConstraintCovered: true,
  valueConstraintCovered: true,
  rowCount: 0,
  rowChecksum: 'unchanged',
};

test('preflight permits a missing table for an expand migration', () => {
  assert.doesNotThrow(() =>
    validateCustomerIdSequencePreflight({
      ...validReport,
      tableExists: false,
      columns: [],
    }),
  );
});

test('preflight rejects incompatible or ambiguous existing data', () => {
  assert.throws(
    () =>
      validateCustomerIdSequencePreflight({
        ...validReport,
        invalidRows: ['260730'],
      }),
    /invalid rows/,
  );
  assert.throws(
    () =>
      validateCustomerIdSequencePreflight({
        ...validReport,
        columns: validReport.columns.map((column) =>
          column.name === 'current_value'
            ? { ...column, dataType: 'integer' }
            : column,
        ),
      }),
    /incompatible schema/,
  );
});

test('postflight rejects row mutation and incomplete constraints', () => {
  assert.throws(
    () =>
      validateCustomerIdSequencePostflight(validReport, {
        ...validReport,
        rowChecksum: 'changed',
      }),
    /checksum changed/,
  );
  assert.throws(
    () =>
      validateCustomerIdSequencePostflight(validReport, {
        ...validReport,
        valueConstraintCovered: false,
      }),
    /domain constraints/,
  );
});

test('runner is dry-run by default and contains production guards', () => {
  const runner = readFileSync(
    new URL('../run-customer-id-sequences-migration.mjs', import.meta.url),
    'utf8',
  );
  assert.match(runner, /BEGIN TRANSACTION READ ONLY/);
  assert.match(runner, /pg_try_advisory_lock/);
  assert.match(runner, /--target-db/);
  assert.match(runner, /--backup-reference/);
  assert.match(runner, /--logical-export/);
  assert.match(runner, /APPLY_CUSTOMER_ID_SEQUENCES_20260730/);
  assert.match(runner, /app_schema_migrations/);
});

test('expand SQL creates only the required constrained sequence table', () => {
  const sql = readFileSync(
    new URL(
      '../migrations/2026-07-30_customer_id_sequences_expand.sql',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS customer_id_sequences/i);
  assert.match(sql, /PRIMARY KEY \(sequence_date\)/i);
  assert.match(sql, /current_value >= 0/i);
  assert.match(sql, /VALIDATE CONSTRAINT/i);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE|UPDATE)\b/i);
});
