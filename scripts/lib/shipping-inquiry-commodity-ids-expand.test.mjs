import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  validateInquiryIdsExpandPostflight,
  validateInquiryIdsExpandPreflight,
} from '../run-independent-commodity-catalog-migration.mjs';

const SQL_URL = new URL(
  '../migrations/2026-08-19_shipping_inquiry_commodity_ids_expand.sql',
  import.meta.url,
);

test('preflight accepts legacy shape and rejects linked identity constraints', () => {
  assert.doesNotThrow(() =>
    validateInquiryIdsExpandPreflight(report({ columnsExist: false })),
  );
  assert.throws(
    () =>
      validateInquiryIdsExpandPreflight(
        report({ columnsExist: false, partialColumns: true }),
      ),
    /preflight blockers/i,
  );
  assert.throws(
    () =>
      validateInquiryIdsExpandPreflight(
        report({ linkedConstraintExists: true }),
      ),
    /preflight blockers/i,
  );
});

test('postflight requires nullable independent FKs/indexes and unchanged business rows', () => {
  const before = report({
    columnsExist: false,
    typeFkExists: false,
    commodityFkExists: false,
  });
  assert.doesNotThrow(() =>
    validateInquiryIdsExpandPostflight(before, report()),
  );
  assert.throws(
    () =>
      validateInquiryIdsExpandPostflight(
        before,
        report({ rowChecksum: 'changed' }),
      ),
    /inquiry rows changed/i,
  );
  assert.throws(
    () =>
      validateInquiryIdsExpandPostflight(
        before,
        report({ idsNullable: false }),
      ),
    /nullable/i,
  );
  assert.throws(
    () =>
      validateInquiryIdsExpandPostflight(
        before,
        report({ typeFkDeleteAction: 'c' }),
      ),
    /restrict/i,
  );
});

test('SQL is idempotent expand-only and preserves cargo snapshot strings', () => {
  const sql = readFileSync(SQL_URL, 'utf8');
  const executable = sql.replace(/--.*$/gm, '');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS commodity_type_id INTEGER/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS commodity_id INTEGER/i);
  assert.match(sql, /REFERENCES public\.commodity_types \(id\)/i);
  assert.match(sql, /REFERENCES public\.commodities \(id\)/i);
  assert.match(sql, /idx_shipping_agency_inquiries_commodity_type_id/i);
  assert.match(sql, /idx_shipping_agency_inquiries_commodity_id/i);
  assert.doesNotMatch(executable, /\bUPDATE\b|\bINSERT\b|\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(
    executable,
    /UNIQUE[\s\S]*commodity_type_id[\s\S]*commodity_id/i,
  );
  assert.doesNotMatch(executable, /ALTER COLUMN (?:cargo_type|cargo_name)/i);
});

test('runner phase and entity retain string snapshots beside nullable IDs', () => {
  const runner = readFileSync(
    new URL(
      '../run-independent-commodity-catalog-migration.mjs',
      import.meta.url,
    ),
    'utf8',
  );
  const entity = readFileSync(
    new URL(
      '../../src/features/inquiry/entities/shipping-agency-inquiry.entity.ts',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(runner, /inquiry-expand/);
  assert.match(entity, /commodityTypeId!: number \| null/);
  assert.match(entity, /commodityId!: number \| null/);
  assert.match(entity, /cargoType!: string \| null/);
  assert.match(entity, /cargoName!: string \| null/);
});

function report(overrides = {}) {
  return {
    inquiryTableExists: true,
    commodityTypesTableExists: true,
    commoditiesTableExists: true,
    columnsExist: true,
    partialColumns: false,
    idsNullable: true,
    typeFkExists: true,
    commodityFkExists: true,
    typeFkValid: true,
    commodityFkValid: true,
    typeFkDeleteAction: 'r',
    commodityFkDeleteAction: 'r',
    typeIndexExists: true,
    commodityIndexExists: true,
    linkedConstraintExists: false,
    rowCount: 2,
    nullTypeCount: 2,
    nullCommodityCount: 2,
    rowChecksum: 'same',
    ...overrides,
  };
}
