import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  validateGalleryTypeExpandPostflight,
  validateGalleryTypeExpandPreflight,
} from '../run-independent-commodity-catalog-migration.mjs';

const SQL_URL = new URL(
  '../migrations/2026-08-19_gallery_commodity_type_expand.sql',
  import.meta.url,
);

test('preflight accepts legacy gallery shape and rejects forbidden coupling', () => {
  const legacy = report({
    columnExists: false,
    fkExists: false,
    indexExists: false,
  });
  assert.doesNotThrow(() => validateGalleryTypeExpandPreflight(legacy));
  assert.throws(
    () =>
      validateGalleryTypeExpandPreflight(
        report({ assignmentTableExists: true }),
      ),
    /preflight blockers/i,
  );
  assert.throws(
    () =>
      validateGalleryTypeExpandPreflight(
        report({ compositeConstraintExists: true }),
      ),
    /preflight blockers/i,
  );
});

test('postflight requires nullable column, FK/index and unchanged rows', () => {
  const before = report({
    columnExists: false,
    fkExists: false,
    indexExists: false,
  });
  const after = report();
  assert.doesNotThrow(() => validateGalleryTypeExpandPostflight(before, after));
  assert.throws(
    () =>
      validateGalleryTypeExpandPostflight(
        before,
        report({ rowChecksum: 'changed' }),
      ),
    /gallery image rows changed/i,
  );
  assert.throws(
    () =>
      validateGalleryTypeExpandPostflight(
        before,
        report({ columnNullable: false }),
      ),
    /nullable/i,
  );
});

test('SQL is idempotent expand-only with no backfill or Type-Commodity pairing', () => {
  const sql = readFileSync(SQL_URL, 'utf8');
  const executable = sql.replace(/--.*$/gm, '');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS commodity_type_id INTEGER/i);
  assert.match(sql, /REFERENCES public\.commodity_types \(id\)/i);
  assert.match(sql, /ON DELETE RESTRICT/i);
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS idx_gallery_images_commodity_type_id/i,
  );
  assert.doesNotMatch(executable, /\bUPDATE\b|\bINSERT\b|\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(executable, /commodity_type_assignments/i);
  assert.doesNotMatch(
    executable,
    /UNIQUE[\s\S]*(?:commodity_id[\s\S]*commodity_type_id|commodity_type_id[\s\S]*commodity_id)/i,
  );
});

test('runner and entity expose nullable independent Type metadata', () => {
  const runner = readFileSync(
    new URL(
      '../run-independent-commodity-catalog-migration.mjs',
      import.meta.url,
    ),
    'utf8',
  );
  const entity = readFileSync(
    new URL(
      '../../src/features/gallery/entities/gallery-image.entity.ts',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(runner, /gallery-expand/);
  assert.match(runner, /BEGIN TRANSACTION READ ONLY/);
  assert.match(entity, /commodityTypeId!: number \| null/);
  assert.match(entity, /@ManyToOne\(\(\) => CommodityType, \{ nullable: true/);
  assert.doesNotMatch(entity, /commodityType[\s\S]*commodity:/);
});

function report(overrides = {}) {
  return {
    galleryTableExists: true,
    commodityTypesTableExists: true,
    columnExists: true,
    columnNullable: true,
    columnType: 'integer',
    fkExists: true,
    fkValid: true,
    fkDeleteAction: 'r',
    indexExists: true,
    assignmentTableExists: false,
    compositeConstraintExists: false,
    rowCount: 9,
    rowChecksum: 'same',
    ...overrides,
  };
}
