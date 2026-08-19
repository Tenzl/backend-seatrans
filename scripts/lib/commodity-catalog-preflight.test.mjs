import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertReadOnlySql,
  buildCommodityDuplicateReport,
  buildPackageTypeReport,
  normalizeCatalogKey,
  parseCanonicalPackageTypesSql,
} from './commodity-catalog-preflight.mjs';

test('normalizeCatalogKey trims, collapses whitespace and ignores case', () => {
  assert.equal(normalizeCatalogKey('  jumbo   bag(s) '), 'JUMBO BAG(S)');
  assert.equal(normalizeCatalogKey(null), '');
});

test('duplicate report keeps the most referenced row, then the lowest id', () => {
  const rows = [
    {
      id: 37,
      serviceTypeId: 1,
      serviceName: 'SHIPPING AGENCY',
      name: ' pke ',
      displayName: 'PKE',
      galleryReferences: 0,
      bookingReferences: 0,
      arrivalNoticeReferences: 0,
      deliveryOrderReferences: 0,
      billOfLadingReferences: 0,
      inquiryReferences: 0,
    },
    {
      id: 19,
      serviceTypeId: 1,
      serviceName: 'SHIPPING AGENCY',
      name: 'PKE',
      displayName: 'PKE',
      galleryReferences: 9,
      bookingReferences: 0,
      arrivalNoticeReferences: 0,
      deliveryOrderReferences: 0,
      billOfLadingReferences: 0,
      inquiryReferences: 0,
    },
    {
      id: 40,
      serviceTypeId: 2,
      serviceName: 'FREIGHT FORWARDING',
      name: 'PKE',
      displayName: 'PKE',
      galleryReferences: 20,
      bookingReferences: 0,
      arrivalNoticeReferences: 0,
      deliveryOrderReferences: 0,
      billOfLadingReferences: 0,
      inquiryReferences: 0,
    },
  ];

  assert.deepEqual(buildCommodityDuplicateReport(rows), [
    {
      serviceTypeId: 1,
      serviceName: 'SHIPPING AGENCY',
      normalizedName: 'PKE',
      canonicalId: 19,
      duplicateIds: [37],
      rows: [
        { ...rows[1], totalReferences: 9 },
        { ...rows[0], totalReferences: 0 },
      ],
    },
  ]);
});

test('duplicate report uses the lowest id when reference totals tie', () => {
  const base = {
    serviceTypeId: 1,
    serviceName: 'SHIPPING AGENCY',
    name: 'BULK',
    displayName: 'Bulk',
    galleryReferences: 0,
    bookingReferences: 1,
    arrivalNoticeReferences: 0,
    deliveryOrderReferences: 0,
    billOfLadingReferences: 0,
    inquiryReferences: 0,
  };
  const report = buildCommodityDuplicateReport([
    { ...base, id: 8 },
    { ...base, id: 3 },
  ]);
  assert.equal(report[0].canonicalId, 3);
  assert.deepEqual(report[0].duplicateIds, [8]);
});

test('package report merges case variants and flags dashboard options', () => {
  assert.deepEqual(
    buildPackageTypeReport(
      [
        { documentType: 'BL', value: ' crate(s) ', occurrences: 1 },
        { documentType: 'AN', value: 'CRATE(S)', occurrences: 2 },
        { documentType: 'DO', value: 'Legacy Pack', occurrences: 1 },
      ],
      ['CRATE(S)', 'PKGS'],
    ),
    [
      {
        normalizedValue: 'CRATE(S)',
        displayValue: 'CRATE(S)',
        inDashboardOptions: true,
        occurrences: 3,
        sources: [
          { documentType: 'AN', occurrences: 2 },
          { documentType: 'BL', occurrences: 1 },
        ],
        variants: ['CRATE(S)', 'crate(s)'],
      },
      {
        normalizedValue: 'LEGACY PACK',
        displayValue: 'Legacy Pack',
        inDashboardOptions: false,
        occurrences: 1,
        sources: [{ documentType: 'DO', occurrences: 1 }],
        variants: ['Legacy Pack'],
      },
    ],
  );
});

test('preflight reads the canonical 101 Package Types from the data migration', () => {
  const sql = readFileSync(
    new URL('../migrations/2026-08-19_package_types_data.sql', import.meta.url),
    'utf8',
  );
  const values = parseCanonicalPackageTypesSql(sql);
  assert.equal(values.length, 101);
  assert.equal(values[0], 'CRT');
  assert.equal(values[13], 'CRATE(S)');
  assert.equal(values.at(-1), 'ZZ');

  const runner = readFileSync(
    new URL('../preflight-independent-commodity-catalog.mjs', import.meta.url),
    'utf8',
  );
  assert.match(runner, /2026-08-19_package_types_data\.sql/);
  assert.doesNotMatch(runner, /AN_CONTAINER_PACKAGE_TYPES/);
});

test('read-only guard rejects mutating SQL outside comments', () => {
  assert.doesNotThrow(() =>
    assertReadOnlySql('SELECT * FROM commodities -- UPDATE is documentation'),
  );
  assert.throws(
    () => assertReadOnlySql('SELECT 1; DELETE FROM commodities'),
    /mutating SQL/i,
  );
  assert.throws(
    () => assertReadOnlySql('CREATE TEMP TABLE report AS SELECT 1'),
    /mutating SQL/i,
  );
});

test('runner opens a read-only transaction and always rolls back', () => {
  const runner = readFileSync(
    new URL('../preflight-independent-commodity-catalog.mjs', import.meta.url),
    'utf8',
  );
  assert.match(runner, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/i);
  assert.match(runner, /ROLLBACK/);
  assert.doesNotMatch(runner, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
});
