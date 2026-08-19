import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  buildCommodityTypeCandidates,
  canonicalCommodityTypeCode,
  hasNonblankCheck,
  isNormalizedUniqueIndex,
  summarizeCommodityTypeBackfill,
  validateCommodityTypeBackfillPostflight,
  validateCommodityTypeBackfillPreflight,
} from '../run-independent-commodity-catalog-migration.mjs';

test('postflight accepts PostgreSQL varchar casts in nonblank checks', () => {
  const definitions = [
    "CHECK (((btrim((code)::text) <> ''::text)))",
    "CHECK (((btrim((name)::text) <> ''::text)))",
  ].join('\n');
  assert.equal(hasNonblankCheck(definitions, 'code'), true);
  assert.equal(hasNonblankCheck(definitions, 'name'), true);
  assert.equal(hasNonblankCheck(definitions, 'missing'), false);
});

test('postflight accepts PostgreSQL btree and varchar casts in normalized indexes', () => {
  const definition =
    'CREATE UNIQUE INDEX uq_test ON public.commodity_types USING btree (service_type_id, lower(btrim((code)::text)))';
  assert.equal(isNormalizedUniqueIndex(definition, 'code'), true);
  assert.equal(isNormalizedUniqueIndex(definition, 'name'), false);
});

const SQL_URL = new URL(
  '../migrations/2026-08-19_commodity_types_data.sql',
  import.meta.url,
);
const RUNNER_URL = new URL(
  '../run-independent-commodity-catalog-migration.mjs',
  import.meta.url,
);

test('canonical code preserves business codes and normalizes Group labels', () => {
  assert.equal(canonicalCommodityTypeCode('IN_BULK'), 'IN_BULK');
  assert.equal(canonicalCommodityTypeCode('IN_BAG_PACK'), 'IN_BAG_PACK');
  assert.equal(canonicalCommodityTypeCode('EQUIPMENT'), 'IN_EQUIPMENT');
  assert.equal(canonicalCommodityTypeCode('Bag/Pack'), 'IN_BAG_PACK');
  assert.equal(canonicalCommodityTypeCode('project-cargo'), 'IN_PROJECT_CARGO');
  assert.equal(canonicalCommodityTypeCode('  '), '');
});

test('candidate builder covers every Service and prefers Group display names', () => {
  const candidates = buildCommodityTypeCandidates({
    serviceTypes: [
      { id: 1, name: 'SHIPPING AGENCY', displayName: 'Shipping Agency' },
      { id: 2, name: 'FREIGHT FORWARDING', displayName: 'Freight Forwarding' },
      { id: 3, name: 'CHARTERING', displayName: 'Chartering' },
      { id: 4, name: 'LOGISTICS', displayName: 'Logistics' },
    ],
    groups: [
      { id: 1, serviceTypeId: 1, name: 'BAG/PACK' },
      { id: 2, serviceTypeId: 1, name: 'BULK' },
      { id: 3, serviceTypeId: 1, name: 'EQUIPMENT' },
      { id: 7, serviceTypeId: 2, name: 'PALLETS' },
      { id: 5, serviceTypeId: 3, name: 'BAG PACK' },
      { id: 6, serviceTypeId: 4, name: 'BAG PACK' },
    ],
    cargoTypes: [
      {
        code: 'IN_BAG_PACK',
        serviceTypeType: 'SHIPPING_AGENCY',
        displayLabel: 'in bag/pack',
      },
      {
        code: 'IN_BULK',
        serviceTypeType: 'SHIPPING_AGENCY',
        displayLabel: 'in bulk',
      },
      {
        code: 'EQUIPMENT',
        serviceTypeType: 'SHIPPING_AGENCY',
        displayLabel: 'equipment',
      },
    ],
  });

  assert.deepEqual(
    candidates.map(({ serviceTypeId, code, name }) => ({
      serviceTypeId,
      code,
      name,
    })),
    [
      { serviceTypeId: 1, code: 'IN_BAG_PACK', name: 'BAG/PACK' },
      { serviceTypeId: 1, code: 'IN_BULK', name: 'BULK' },
      { serviceTypeId: 1, code: 'IN_EQUIPMENT', name: 'EQUIPMENT' },
      { serviceTypeId: 2, code: 'IN_PALLETS', name: 'PALLETS' },
      { serviceTypeId: 3, code: 'IN_BAG_PACK', name: 'BAG PACK' },
      { serviceTypeId: 4, code: 'IN_BAG_PACK', name: 'BAG PACK' },
    ],
  );
});

test('preflight blocks unresolved Service and conflicting existing names', () => {
  const base = summarizeCommodityTypeBackfill({
    groups: [{ id: 1, serviceTypeId: 99, name: 'BULK' }],
    cargoTypes: [],
    serviceTypes: [],
    catalogTypes: [],
    groupSnapshot: { rowCount: 1, checksum: 'groups' },
    commoditySnapshot: { rowCount: 29, checksum: 'commodities' },
  });
  assert.throws(
    () => validateCommodityTypeBackfillPreflight(base),
    /preflight blockers/i,
  );

  const conflict = summarizeCommodityTypeBackfill({
    groups: [{ id: 1, serviceTypeId: 1, name: 'BULK' }],
    cargoTypes: [],
    serviceTypes: [{ id: 1, name: 'SHIPPING AGENCY' }],
    catalogTypes: [{ id: 9, serviceTypeId: 1, code: 'OTHER', name: 'bulk' }],
    groupSnapshot: { rowCount: 1, checksum: 'groups' },
    commoditySnapshot: { rowCount: 29, checksum: 'commodities' },
  });
  assert.throws(
    () => validateCommodityTypeBackfillPreflight(conflict),
    /preflight blockers/i,
  );

  const duplicateCatalog = summarizeCommodityTypeBackfill({
    groups: [],
    cargoTypes: [],
    serviceTypes: [{ id: 1, name: 'SHIPPING AGENCY' }],
    catalogTypes: [
      { id: 1, serviceTypeId: 1, code: 'IN_BULK', name: 'Bulk' },
      { id: 2, serviceTypeId: 1, code: 'in_bulk', name: 'Other' },
    ],
    groupSnapshot: { rowCount: 0, checksum: 'groups' },
    commoditySnapshot: { rowCount: 29, checksum: 'commodities' },
  });
  assert.throws(
    () => validateCommodityTypeBackfillPreflight(duplicateCatalog),
    /preflight blockers/i,
  );
});

test('postflight proves coverage, exact count growth and zero legacy mutation', () => {
  const input = {
    groups: [{ id: 1, serviceTypeId: 1, name: 'BULK' }],
    cargoTypes: [],
    serviceTypes: [{ id: 1, name: 'SHIPPING AGENCY' }],
    groupSnapshot: { rowCount: 1, checksum: 'groups' },
    commoditySnapshot: { rowCount: 29, checksum: 'commodities' },
  };
  const before = summarizeCommodityTypeBackfill({
    ...input,
    catalogTypes: [],
  });
  const after = summarizeCommodityTypeBackfill({
    ...input,
    catalogTypes: [{ id: 10, serviceTypeId: 1, code: 'IN_BULK', name: 'BULK' }],
  });

  assert.doesNotThrow(() =>
    validateCommodityTypeBackfillPostflight(before, after),
  );
  assert.throws(
    () =>
      validateCommodityTypeBackfillPostflight(before, {
        ...after,
        commoditySnapshot: { rowCount: 29, checksum: 'changed' },
      }),
    /commodities changed/i,
  );
});

test('data SQL is idempotent and never mutates Commodity/Group ownership', () => {
  const sql = readFileSync(SQL_URL, 'utf8');
  const executable = sql.replace(/--.*$/gm, '');
  assert.match(sql, /INSERT INTO (?:public\.)?commodity_types/i);
  assert.match(sql, /FROM (?:public\.)?commodity_groups/i);
  assert.match(sql, /FROM (?:public\.)?cargo_types/i);
  assert.match(sql, /ON CONFLICT DO NOTHING/i);
  assert.doesNotMatch(executable, /commodity_type_assignments/i);
  assert.doesNotMatch(
    executable,
    /\b(?:UPDATE|DELETE\s+FROM|TRUNCATE|DROP|ALTER)\b/i,
  );
  assert.doesNotMatch(executable, /INSERT INTO (?:public\.)?commodities/i);
});

test('runner exposes data phase safety and roll-forward recovery contract', () => {
  const runner = readFileSync(RUNNER_URL, 'utf8');
  assert.match(runner, /--phase=data/);
  assert.match(runner, /rollForwardRecovery/);
  assert.match(runner, /BEGIN TRANSACTION READ ONLY/);
  assert.match(runner, /pg_try_advisory_lock/);
});

test('importing runner is side-effect free and never opens a database client', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(RUNNER_URL.href)})`,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        DB_URL: 'postgresql://invalid:invalid@127.0.0.1:1/must_not_connect',
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
