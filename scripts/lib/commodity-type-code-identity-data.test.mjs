import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyCodeIdentityFixture,
  buildCodeIdentityPlan,
  createCodeIdentityRecoveryEnvelope,
  readCodeIdentityRecoveryExport,
  summarizeCodeIdentityFixture,
  validateCodeIdentityDataPostflight,
  validateCodeIdentityDataPreflight,
  verifyCodeIdentityDataApplyGuards,
  verifyCodeIdentityDataStatic,
  writeCodeIdentityRecoveryExport,
} from '../run-commodity-type-code-removal.mjs';

const SQL_URL = new URL(
  '../migrations/2026-08-19_commodity_type_code_identity_data.sql',
  import.meta.url,
);
const RUNNER_URL = new URL(
  '../run-commodity-type-code-removal.mjs',
  import.meta.url,
);

test('data SQL derives IDs by Shipping Agency Service plus normalized current Type code', () => {
  const sql = readFileSync(SQL_URL, 'utf8');
  const result = verifyCodeIdentityDataStatic(sql);

  assert.equal(result.forwardOnly, true);
  assert.deepEqual(result.updatedTables, [
    'epda_parameter_set',
    'shipping_agency_inquiries',
  ]);
  assert.match(sql, /service_types/i);
  assert.match(sql, /commodity_types/i);
  assert.match(sql, /service_type_id/i);
  assert.match(sql, /regexp_replace[\s\S]*?upper[\s\S]*?cargo_type/i);
  assert.match(sql, /commodityTypeId/i);
  assert.match(sql, /typeNameSnapshot/i);
  assert.match(
    sql,
    /'typeNameSnapshot',\s*coalesce\([\s\S]*?rate->>'typeNameSnapshot'[\s\S]*?commodity_type\.name/i,
  );
  assert.doesNotMatch(
    sql,
    /jsonb_array_elements\(parameter_set\.values->'cargoAgencyRates'\)/i,
  );
  assert.doesNotMatch(sql, /commodity_type_id\s*=\s*\d+/i);
});

test('data SQL aborts unresolved, ambiguous and malformed rows before updates', () => {
  const sql = readFileSync(SQL_URL, 'utf8');
  const firstUpdate = sql.search(/\bUPDATE\s+public\./i);
  for (const marker of [
    'ambiguous Commodity Type codes',
    'unresolved inquiry cargo_type',
    'malformed EPDA cargoAgencyRates',
    'unresolved EPDA cargoAgencyRates',
  ]) {
    const position = sql.indexOf(marker);
    assert.ok(position >= 0, marker);
    assert.ok(
      position < firstUpdate,
      `${marker} must be checked before UPDATE`,
    );
  }
  assert.match(sql, /RAISE EXCEPTION/i);
  assert.doesNotMatch(sql, /\b(?:INSERT|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
});

test('fixture migration preserves inquiry text and EPDA code/label/numeric rates', () => {
  const input = fixture();
  const before = summarizeCodeIdentityFixture(input);
  const plan = buildCodeIdentityPlan(input);
  assert.doesNotThrow(() => validateCodeIdentityDataPreflight(before, plan));
  assert.equal(plan.inquiryMappings.length, 7);
  assert.equal(plan.rateMappings.length, 3);
  assert.ok(plan.inquiryMappings.every((row) => row.commodityTypeId === 2));

  const migrated = applyCodeIdentityFixture(input, plan);
  const after = summarizeCodeIdentityFixture(migrated);
  assert.doesNotThrow(() =>
    validateCodeIdentityDataPostflight(before, after, plan),
  );
  assert.equal(after.inquiryCargoTypeChecksum, before.inquiryCargoTypeChecksum);
  assert.equal(after.numericRateChecksum, before.numericRateChecksum);
  assert.equal(after.legacyRateChecksum, before.legacyRateChecksum);
  assert.deepEqual(
    migrated.epdaParameterSets[0].values.cargoAgencyRates.map((rate) => ({
      commodityTypeId: rate.commodityTypeId,
      typeNameSnapshot: rate.typeNameSnapshot,
      code: rate.code,
      label: rate.label,
      rate: rate.rate,
    })),
    [
      {
        commodityTypeId: 1,
        typeNameSnapshot: 'BAG/PACK',
        code: 'IN_BAG_PACK',
        label: 'Bag',
        rate: 0.06,
      },
      {
        commodityTypeId: 2,
        typeNameSnapshot: 'BULK',
        code: 'IN_BULK',
        label: 'Bulk',
        rate: 0.05,
      },
      {
        commodityTypeId: 3,
        typeNameSnapshot: 'EQUIPMENT',
        code: 'IN_EQUIPMENT',
        label: 'Equipment',
        rate: 0.1,
      },
    ],
  );
});

test('fixture migration is idempotent', () => {
  const input = fixture();
  const first = applyCodeIdentityFixture(input, buildCodeIdentityPlan(input));
  const second = applyCodeIdentityFixture(first, buildCodeIdentityPlan(first));
  assert.deepEqual(second, first);
});

test('rerun after a catalog rename preserves the existing historical Type name snapshot', () => {
  const input = fixture();
  const first = applyCodeIdentityFixture(input, buildCodeIdentityPlan(input));
  const renamed = structuredClone(first);
  renamed.commodityTypes.find((type) => type.id === 2).name = 'RENAMED BULK';

  const rerun = applyCodeIdentityFixture(
    renamed,
    buildCodeIdentityPlan(renamed),
  );
  const bulkRate = rerun.epdaParameterSets[0].values.cargoAgencyRates[1];
  assert.equal(bulkRate.commodityTypeId, 2);
  assert.equal(bulkRate.typeNameSnapshot, 'BULK');
  assert.equal(bulkRate.code, 'IN_BULK');
  assert.equal(bulkRate.label, 'Bulk');
  assert.equal(bulkRate.rate, 0.05);
  assert.deepEqual(rerun.shippingInquiries, first.shippingInquiries);
});

test('fixture preflight aborts unresolved, ambiguous, malformed and conflicting identity data', () => {
  const unresolved = fixture();
  unresolved.shippingInquiries[0].cargoType = 'UNKNOWN';
  assert.throws(() => buildCodeIdentityPlan(unresolved), /unresolved inquiry/i);

  const ambiguous = fixture();
  ambiguous.commodityTypes.push({
    ...ambiguous.commodityTypes[1],
    id: 99,
    code: 'in bulk',
  });
  assert.throws(() => buildCodeIdentityPlan(ambiguous), /ambiguous/i);

  const malformed = fixture();
  malformed.epdaParameterSets[0].values.cargoAgencyRates[0].rate = 'bad';
  assert.throws(() => buildCodeIdentityPlan(malformed), /malformed EPDA/i);

  const conflicting = fixture();
  conflicting.shippingInquiries[0].commodityTypeId = 3;
  assert.throws(() => buildCodeIdentityPlan(conflicting), /stored Type ID/i);
});

test('apply guard requires distinct data confirmation and recovery evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'type-code-identity-guard-'));
  const exportPath = join(directory, 'recovery.json');
  const base = {
    mode: 'apply',
    phase: 'data',
    targetDb: 'fixture',
    backupReference: 'provider-backup-20260819',
    logicalExport: exportPath,
    restoreTestReference: 'restore-copy-20260819',
    rollForwardTestReference: 'idempotent-copy-20260819',
    confirmation: 'WRONG',
  };
  assert.throws(
    () =>
      verifyCodeIdentityDataApplyGuards(
        { ...base, backupReference: null },
        { database: 'fixture' },
      ),
    /backup-reference/i,
  );
  assert.throws(
    () =>
      verifyCodeIdentityDataApplyGuards(
        { ...base, restoreTestReference: null },
        { database: 'fixture' },
      ),
    /restore-test-reference/i,
  );
  assert.throws(
    () =>
      verifyCodeIdentityDataApplyGuards(
        { ...base, rollForwardTestReference: null },
        { database: 'fixture' },
      ),
    /roll-forward-test-reference/i,
  );
  assert.throws(
    () => verifyCodeIdentityDataApplyGuards(base, { database: 'fixture' }),
    /APPLY_COMMODITY_TYPE_CODE_IDENTITY_DATA_20260819/,
  );
  assert.doesNotThrow(() =>
    verifyCodeIdentityDataApplyGuards(
      {
        ...base,
        confirmation: 'APPLY_COMMODITY_TYPE_CODE_IDENTITY_DATA_20260819',
      },
      { database: 'fixture' },
    ),
  );
  writeFileSync(exportPath, '{}');
  assert.throws(
    () =>
      verifyCodeIdentityDataApplyGuards(
        {
          ...base,
          confirmation: 'APPLY_COMMODITY_TYPE_CODE_IDENTITY_DATA_20260819',
        },
        { database: 'fixture' },
      ),
    /overwrite/i,
  );
});

test('data runner uses a distinct ledger, checksum, advisory lock and rollback-safe transaction', () => {
  const runner = readFileSync(RUNNER_URL, 'utf8');
  assert.match(runner, /commodity_type_code_identity_data_v1/i);
  assert.match(runner, /APPLY_COMMODITY_TYPE_CODE_IDENTITY_DATA_20260819/);
  assert.match(
    runner,
    /seatrans:commodity-type-code-identity-data:2026-08-19:v1/,
  );
  assert.match(runner, /createHash\('sha256'\)\.update\(sql\)/);
  assert.match(runner, /pg_try_advisory_lock/);
  assert.match(runner, /BEGIN ISOLATION LEVEL REPEATABLE READ/);
  assert.match(
    runner,
    /LOCK TABLE public\.service_types, public\.commodity_types, public\.shipping_agency_inquiries, public\.epda_parameter_set/i,
  );
  assert.match(runner, /app_schema_migrations/);
  assert.match(runner, /ROLLBACK/);
});

test('targeted recovery envelope is checksummed and requires tested evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'type-code-identity-export-'));
  const path = join(directory, 'recovery.json');
  const input = fixture();
  const snapshot = {
    shippingInquiries: input.shippingInquiries,
    epdaParameterSets: input.epdaParameterSets,
  };
  const envelope = createCodeIdentityRecoveryEnvelope(snapshot, {
    backupReference: 'provider-backup-20260819',
    restoreTestReference: 'restore-copy-20260819',
    rollForwardTestReference: 'idempotent-copy-20260819',
  });
  writeCodeIdentityRecoveryExport(path, envelope);
  assert.deepEqual(readCodeIdentityRecoveryExport(path).snapshot, snapshot);

  const corrupted = JSON.parse(readFileSync(path, 'utf8'));
  corrupted.snapshot.shippingInquiries[0].cargoType = 'CORRUPTED';
  writeFileSync(path, JSON.stringify(corrupted));
  assert.throws(() => readCodeIdentityRecoveryExport(path), /checksum/i);
});

function fixture() {
  return {
    shippingAgencyServiceTypeId: 1,
    commodityTypes: [
      {
        id: 1,
        serviceTypeId: 1,
        code: 'IN_BAG_PACK',
        name: 'BAG/PACK',
      },
      { id: 2, serviceTypeId: 1, code: 'IN_BULK', name: 'BULK' },
      {
        id: 3,
        serviceTypeId: 1,
        code: 'IN_EQUIPMENT',
        name: 'EQUIPMENT',
      },
      { id: 20, serviceTypeId: 2, code: 'IN_BULK', name: 'BULK' },
    ],
    shippingInquiries: Array.from({ length: 7 }, (_, index) => ({
      id: index + 100,
      cargoType: 'IN_BULK',
      commodityTypeId: null,
    })),
    epdaParameterSets: [
      {
        id: 20,
        scope: 'AREA',
        area: 'SOUTHERN',
        portId: null,
        name: null,
        values: {
          cargoAgencyRates: [
            { code: 'IN_BAG_PACK', label: 'Bag', rate: 0.06 },
            { code: 'IN_BULK', label: 'Bulk', rate: 0.05 },
            { code: 'IN_EQUIPMENT', label: 'Equipment', rate: 0.1 },
          ],
        },
      },
    ],
  };
}
