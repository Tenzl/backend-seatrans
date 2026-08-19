import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertReadOnlySql,
  buildCommodityTypeCodeRemovalPreflight,
  buildCommodityTypeReport,
  buildEpdaRateReport,
  buildInquiryCargoTypeReport,
  normalizeTypeKey,
} from './commodity-type-code-removal-preflight.mjs';

const TYPES = [
  {
    id: 11,
    serviceTypeId: 1,
    serviceName: 'SHIPPING_AGENCY',
    serviceDisplayName: 'Shipping Agency',
    code: 'IN_BULK',
    name: 'BULK',
  },
  {
    id: 12,
    serviceTypeId: 1,
    serviceName: 'SHIPPING_AGENCY',
    serviceDisplayName: 'Shipping Agency',
    code: 'EQUIPMENT',
    name: 'EQUIPMENT',
  },
  {
    id: 21,
    serviceTypeId: 2,
    serviceName: 'FREIGHT_FORWARDING',
    serviceDisplayName: 'Freight Forwarding',
    code: 'IN_BULK',
    name: 'BULK',
  },
];

test('normalizes Type keys without coupling names to codes', () => {
  assert.equal(normalizeTypeKey('  in   bulk '), 'IN BULK');
  assert.equal(normalizeTypeKey(null), '');
});

test('read-only guard accepts reports and rejects DDL/DML', () => {
  assert.doesNotThrow(() => assertReadOnlySql('SELECT * FROM commodity_types'));
  assert.doesNotThrow(() =>
    assertReadOnlySql(`
      -- UPDATE is documentation only
      WITH rows AS (SELECT 'DROP TABLE ignored'::text AS note)
      SELECT * FROM rows
    `),
  );

  for (const sql of [
    "INSERT INTO commodity_types(name) VALUES ('BULK')",
    "WITH target AS (SELECT 1) UPDATE commodity_types SET name = 'BULK'",
    'DELETE FROM commodity_types',
    'MERGE INTO commodity_types USING source ON true WHEN MATCHED THEN DELETE',
    'CREATE TABLE forbidden(id int)',
    'ALTER TABLE commodity_types DROP COLUMN code',
    'DROP TABLE commodity_types',
    'TRUNCATE commodity_types',
    'SELECT 1; GRANT SELECT ON commodity_types TO public',
    'SELECT * INTO temporary_type_copy FROM commodity_types',
  ]) {
    assert.throws(() => assertReadOnlySql(sql), /mutating SQL/i, sql);
  }
});

test('Type report inventories code, name and Service and detects normalized ambiguity', () => {
  const report = buildCommodityTypeReport([
    ...TYPES,
    {
      id: 13,
      serviceTypeId: 1,
      serviceName: 'SHIPPING_AGENCY',
      serviceDisplayName: 'Shipping Agency',
      code: ' in  bulk ',
      name: ' Bulk ',
    },
  ]);

  assert.deepEqual(report.rows[0], {
    ...TYPES[0],
    normalizedCode: 'IN BULK',
    normalizedName: 'BULK',
  });
  assert.deepEqual(report.codeAmbiguities, [
    {
      serviceTypeId: 1,
      serviceName: 'SHIPPING_AGENCY',
      normalizedCode: 'IN BULK',
      typeIds: [11, 13],
    },
  ]);
  assert.deepEqual(report.nameAmbiguities, [
    {
      serviceTypeId: 1,
      serviceName: 'SHIPPING_AGENCY',
      normalizedName: 'BULK',
      typeIds: [11, 13],
    },
  ]);
});

test('inquiry report exposes unique, unresolved and multiply-resolved cargo_type candidates', () => {
  const ambiguousTypes = [
    ...TYPES,
    { ...TYPES[0], id: 13, code: ' in  bulk ', name: 'Bulk duplicate' },
  ];
  const report = buildInquiryCargoTypeReport(
    [
      { id: 100, cargoType: 'IN_BULK', commodityTypeId: null },
      { id: 101, cargoType: 'missing', commodityTypeId: null },
      { id: 102, cargoType: '', commodityTypeId: null },
      { id: 103, cargoType: 'EQUIPMENT', commodityTypeId: 12 },
    ],
    ambiguousTypes,
    1,
  );

  assert.deepEqual(
    report.rows.map((row) => row.candidateTypeIds),
    [[11, 13], [], [], [12]],
  );
  assert.deepEqual(
    report.multiplyResolved.map((row) => row.inquiryId),
    [100],
  );
  assert.deepEqual(
    report.unresolved.map((row) => row.inquiryId),
    [101, 102],
  );
  assert.equal(report.summary.inquiryCount, 4);
  assert.equal(report.summary.uniquelyResolvedCount, 1);
});

test('EPDA rate report lists candidate IDs and a stable numeric-rate checksum', () => {
  const sets = [
    {
      id: 8,
      scope: 'PORT',
      area: null,
      portId: 21,
      name: null,
      values: {
        cargoAgencyRates: [
          { code: 'IN_BULK', label: 'Bulk', rate: 0.125 },
          { code: 'UNKNOWN', label: 'Other', rate: 12 },
        ],
      },
    },
    {
      id: 2,
      scope: 'AREA',
      area: 'SOUTHERN',
      portId: null,
      name: null,
      values: {
        cargoAgencyRates: [
          { code: 'EQUIPMENT', label: 'Equipment', rate: 1.5 },
        ],
      },
    },
  ];

  const first = buildEpdaRateReport(sets, TYPES, 1);
  const second = buildEpdaRateReport([...sets].reverse(), TYPES, 1);

  assert.deepEqual(
    first.rows.map((row) => ({
      parameterSetId: row.parameterSetId,
      rateIndex: row.rateIndex,
      candidateTypeIds: row.candidateTypeIds,
    })),
    [
      { parameterSetId: 2, rateIndex: 0, candidateTypeIds: [12] },
      { parameterSetId: 8, rateIndex: 0, candidateTypeIds: [11] },
      { parameterSetId: 8, rateIndex: 1, candidateTypeIds: [] },
    ],
  );
  assert.deepEqual(
    first.unresolved.map((row) => row.code),
    ['UNKNOWN'],
  );
  assert.deepEqual(first.multiplyResolved, []);
  assert.deepEqual(first.numericRateChecksum, second.numericRateChecksum);
  assert.match(first.numericRateChecksum.sha256, /^[a-f0-9]{64}$/);
  assert.equal(first.numericRateChecksum.rateCount, 3);

  const changed = structuredClone(sets);
  changed[0].values.cargoAgencyRates[0].rate = 0.126;
  assert.notEqual(
    buildEpdaRateReport(changed, TYPES, 1).numericRateChecksum.sha256,
    first.numericRateChecksum.sha256,
  );
});

test('combined preflight summary surfaces all blockers without mutating inputs', () => {
  const input = {
    commodityTypes: TYPES,
    inquiries: [
      { id: 1, cargoType: 'IN_BULK', commodityTypeId: null },
      { id: 2, cargoType: 'IN_BULK', commodityTypeId: null },
    ],
    epdaParameterSets: [
      {
        id: 1,
        scope: 'AREA',
        area: 'SOUTHERN',
        portId: null,
        name: null,
        values: {
          cargoAgencyRates: [{ code: 'IN_BULK', label: 'Bulk', rate: 0.1 }],
        },
      },
    ],
    shippingAgencyServiceTypeId: 1,
  };
  const before = structuredClone(input);
  const report = buildCommodityTypeCodeRemovalPreflight(input);

  assert.deepEqual(input, before);
  assert.equal(report.summary.commodityTypeCount, 3);
  assert.equal(report.summary.inquiryCount, 2);
  assert.equal(report.summary.inquiryCargoTypeCounts.IN_BULK, 2);
  assert.equal(report.summary.epdaRateCount, 1);
  assert.deepEqual(report.blockers, []);
});

test('runner is structurally read-only, rolls back and emits no secrets', () => {
  const runner = readFileSync(
    new URL('../preflight-commodity-type-code-removal.mjs', import.meta.url),
    'utf8',
  );
  assert.match(
    runner,
    /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/i,
  );
  assert.match(runner, /SET LOCAL statement_timeout/i);
  assert.match(runner, /ROLLBACK/i);
  assert.doesNotMatch(runner, /console\.log\([^\n]*(?:password|DB_URL)/i);
});
