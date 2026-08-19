import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as runner from '../run-commodity-type-code-removal.mjs';

const SQL_URL = new URL(
  '../migrations/2026-08-19_commodity_type_code_contract.sql',
  import.meta.url,
);
const RUNNER_URL = new URL(
  '../run-commodity-type-code-removal.mjs',
  import.meta.url,
);
const ENTITY_URL = new URL(
  '../../src/features/commodities/entities/commodity-type.entity.ts',
  import.meta.url,
);

test('contract SQL is limited to verified rate-key cleanup and exact Type code drops', () => {
  const sql = readFileSync(SQL_URL, 'utf8');
  const report = runner.verifyCommodityTypeCodeContractStatic(sql);

  assert.deepEqual(report.updatedTables, ['epda_parameter_set']);
  assert.deepEqual(report.approvedDrops, [
    'uq_commodity_types_service_code_normalized',
    'ck_commodity_types_code_nonblank',
    'commodity_types.code',
  ]);
  assert.match(sql, /rate_value\s*-\s*'code'/i);
  assert.match(sql, /commodityTypeId/i);
  assert.match(sql, /typeNameSnapshot/i);
  assert.match(sql, /RAISE\s+EXCEPTION/i);
  assert.doesNotMatch(sql, /\bCASCADE\b/i);
  assert.doesNotMatch(
    sql.replace(/--.*$/gm, ''),
    /\b(?:cargo_types|package_types|booking_records|arrival_notice_records|delivery_order_records|bill_of_lading_records)\b/i,
  );
});

test('static verifier rejects extra DML, extra drops and unguarded rate cleanup', () => {
  for (const sql of [
    'DROP TABLE public.cargo_types;',
    'ALTER TABLE public.commodity_types DROP COLUMN code CASCADE;',
    "DO $commodity_type_code_contract$ BEGIN ALTER TABLE public.commodity_types ADD COLUMN danger text; UPDATE public.epda_parameter_set SET values = values; DROP INDEX IF EXISTS public.uq_commodity_types_service_code_normalized; ALTER TABLE public.commodity_types DROP CONSTRAINT IF EXISTS ck_commodity_types_code_nonblank; ALTER TABLE public.commodity_types DROP COLUMN IF EXISTS code; RAISE EXCEPTION 'x commodityTypeId typeNameSnapshot jsonb_typeof commodity_types rate_value - ''code'''; END $commodity_type_code_contract$;",
    'UPDATE public.shipping_agency_inquiries SET cargo_type = NULL;',
    "UPDATE public.epda_parameter_set SET values = values #- '{cargoAgencyRates,0,code}';",
  ]) {
    assert.throws(
      () => runner.verifyCommodityTypeCodeContractStatic(sql),
      /contract static verification/i,
    );
  }
});

test('fixture contract removes only legacy rate code and Type code', () => {
  const input = fixture();
  const before = runner.summarizeCommodityTypeCodeContractFixture(input);
  const plan = runner.buildCommodityTypeCodeContractPlan(input);
  assert.equal(plan.rateCodeRemovalCount, 3);

  const contracted = runner.applyCommodityTypeCodeContractFixture(input, plan);
  const after = runner.summarizeCommodityTypeCodeContractFixture(contracted);
  assert.doesNotThrow(() =>
    runner.validateCommodityTypeCodeContractPostflight(before, after, plan),
  );
  assert.ok(
    contracted.commodityTypes.every(
      (commodityType) => !Object.hasOwn(commodityType, 'code'),
    ),
  );
  assert.ok(
    contracted.epdaParameterSets[0].values.cargoAgencyRates.every(
      (rate) => !Object.hasOwn(rate, 'code'),
    ),
  );
  assert.equal(after.typeIdentityChecksum, before.typeIdentityChecksum);
  assert.equal(after.inquiryChecksum, before.inquiryChecksum);
  assert.equal(after.rateContractChecksum, before.rateContractChecksum);
  assert.equal(after.numericRateChecksum, before.numericRateChecksum);
  assert.equal(after.cargoTypesChecksum, before.cargoTypesChecksum);
  assert.equal(after.packageTypesChecksum, before.packageTypesChecksum);
  assert.equal(after.documentChecksum, before.documentChecksum);
});

test('fixture contract refuses unresolved, malformed, non-ID and duplicate-ID rates', () => {
  const cases = [
    (value) =>
      delete value.epdaParameterSets[0].values.cargoAgencyRates[0]
        .commodityTypeId,
    (value) =>
      (value.epdaParameterSets[0].values.cargoAgencyRates[0].commodityTypeId = 999),
    (value) =>
      (value.epdaParameterSets[0].values.cargoAgencyRates[0].rate = 'bad'),
    (value) =>
      (value.epdaParameterSets[0].values.cargoAgencyRates[0].commodityTypeId = 1.5),
    (value) =>
      (value.epdaParameterSets[0].values.cargoAgencyRates[0].commodityTypeId =
        Number.MAX_SAFE_INTEGER),
    (value) =>
      value.epdaParameterSets[0].values.cargoAgencyRates.push({
        ...value.epdaParameterSets[0].values.cargoAgencyRates[0],
      }),
    (value) =>
      (value.epdaParameterSets[0].values.cargoAgencyRates = { bad: true }),
  ];
  for (const mutate of cases) {
    const input = fixture();
    mutate(input);
    assert.throws(
      () => runner.buildCommodityTypeCodeContractPlan(input),
      /contract preflight/i,
    );
  }
});

test('fixture contract is idempotent and safely recognizes the contracted shape', () => {
  const input = fixture();
  const first = runner.applyCommodityTypeCodeContractFixture(
    input,
    runner.buildCommodityTypeCodeContractPlan(input),
  );
  const second = runner.applyCommodityTypeCodeContractFixture(
    first,
    runner.buildCommodityTypeCodeContractPlan(first),
  );
  assert.deepEqual(second, first);
});

test('contract guards require exact target, fresh backup and release evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'type-code-contract-guard-'));
  const now = new Date('2026-08-19T16:00:00.000Z');
  const base = {
    mode: 'apply',
    phase: 'contract',
    targetDb: 'seatrans_copy',
    targetHost: 'db.internal',
    backupReference: 'provider-backup-20260819T1500Z',
    backupCreatedAt: '2026-08-19T15:00:00.000Z',
    logicalExport: join(directory, 'recovery.json'),
    restoreTestReference: 'restore-test-copy-20260819',
    deployReference: 'backend-dashboard-release-20260819',
    observationReference: 'zero-code-observation-24h',
    rootApprovalReference: 'root-approval-task32-20260819',
    confirmation: 'APPLY_COMMODITY_TYPE_CODE_CONTRACT_20260819',
  };
  const config = { database: 'seatrans_copy', host: 'db.internal' };

  assert.doesNotThrow(() =>
    runner.verifyCommodityTypeCodeContractApplyGuards(base, config, now),
  );
  for (const [field, value, pattern] of [
    ['targetDb', 'wrong', /target-db/i],
    ['targetHost', 'wrong', /target-host/i],
    ['backupReference', null, /backup-reference/i],
    ['backupCreatedAt', '2026-08-17T15:00:00.000Z', /fresh backup/i],
    ['restoreTestReference', null, /restore-test-reference/i],
    ['deployReference', null, /deploy-reference/i],
    ['observationReference', null, /observation-reference/i],
    ['rootApprovalReference', null, /root-approval-reference/i],
    ['confirmation', 'WRONG', /APPLY_COMMODITY_TYPE_CODE_CONTRACT/i],
  ]) {
    assert.throws(
      () =>
        runner.verifyCommodityTypeCodeContractApplyGuards(
          { ...base, [field]: value },
          config,
          now,
        ),
      pattern,
    );
  }
});

test('targeted recovery export is checksummed and carries approval evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'type-code-contract-export-'));
  const path = join(directory, 'recovery.json');
  const snapshot = {
    commodityTypesLegacy: fixture().commodityTypes,
    epdaParameterSets: fixture().epdaParameterSets,
    schema: { constraints: [], indexes: [], columns: [] },
  };
  const envelope = runner.createCommodityTypeCodeContractRecoveryEnvelope(
    snapshot,
    {
      backupReference: 'provider-backup',
      backupCreatedAt: '2026-08-19T15:00:00.000Z',
      restoreTestReference: 'restore-copy',
      deployReference: 'release',
      observationReference: 'observation',
      rootApprovalReference: 'root-approval',
    },
  );
  runner.writeCommodityTypeCodeContractRecoveryExport(path, envelope);
  assert.deepEqual(
    runner.readCommodityTypeCodeContractRecoveryExport(path),
    envelope,
  );

  const corrupted = JSON.parse(readFileSync(path, 'utf8'));
  corrupted.snapshot.commodityTypesLegacy[0].code = 'CORRUPTED';
  writeFileSync(path, JSON.stringify(corrupted));
  assert.throws(
    () => runner.readCommodityTypeCodeContractRecoveryExport(path),
    /checksum/i,
  );
});

test('runner contract phase is ledgered, locked and exports recovery before SQL', () => {
  const source = readFileSync(RUNNER_URL, 'utf8');
  assert.match(source, /commodity_type_code_contract_v1/);
  assert.match(source, /pg_try_advisory_lock/);
  assert.match(source, /app_schema_migrations/);
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ/);
  assert.match(
    source,
    /LOCK TABLE public\.commodity_types, public\.epda_parameter_set/i,
  );
  const contract = source.slice(
    source.indexOf('async function runContract'),
    source.indexOf('async function runData'),
  );
  assert.ok(
    contract.indexOf('writeCommodityTypeCodeContractRecoveryExport') <
      contract.indexOf('await client.query(sql)'),
  );
});

test('contract fixture reads the production cargo_types composite key without an id assumption', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      queries.push(normalized);
      if (/FROM public\.commodity_types/i.test(normalized)) {
        return {
          rows: [
            {
              row: {
                id: 1,
                service_type_id: 7,
                name: 'Bulk',
                code: 'IN_BULK',
              },
            },
          ],
        };
      }
      if (/FROM public\.shipping_agency_inquiries/i.test(normalized))
        return { rows: [] };
      if (/FROM public\.epda_parameter_set/i.test(normalized))
        return { rows: [] };
      if (/FROM public\.cargo_types/i.test(normalized)) {
        assert.doesNotMatch(normalized, /cargo_type\.id/i);
        assert.match(
          normalized,
          /ORDER BY cargo_type\.code, cargo_type\.service_type_type/i,
        );
        return {
          rows: [
            {
              row: {
                code: 'IN_BULK',
                service_type_type: 'SHIPPING_AGENCY',
                display_label: 'Bulk',
              },
            },
          ],
        };
      }
      if (/FROM public\.package_types/i.test(normalized)) return { rows: [] };
      if (
        /FROM public\.(?:booking_records|arrival_notice_records|delivery_order_records|bill_of_lading_records)/i.test(
          normalized,
        )
      )
        return { rows: [] };
      throw new Error(`Unexpected fixture query: ${normalized}`);
    },
  };

  const result = await runner.collectContractFixture(client);
  assert.deepEqual(result.cargoTypes, [
    {
      code: 'IN_BULK',
      service_type_type: 'SHIPPING_AGENCY',
      display_label: 'Bulk',
    },
  ]);
  assert.equal(queries.length, 9);
});

test('static contract CLI never opens a database connection', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(RUNNER_URL), '--verify-static', '--phase=contract'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        DB_URL: 'postgresql://invalid:invalid@127.0.0.1:1/must_not_connect',
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /phase.*contract/i);
  assert.match(result.stdout, /scriptChecksum/i);
});

test('contract apply refuses missing release evidence before database connection', () => {
  const directory = mkdtempSync(join(tmpdir(), 'type-code-no-connect-'));
  const exportPath = join(directory, 'recovery.json');
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(RUNNER_URL),
      '--apply',
      '--phase=contract',
      '--target-db=must_not_connect',
      '--target-host=127.0.0.1',
      '--backup-reference=backup',
      `--backup-created-at=${new Date().toISOString()}`,
      `--logical-export=${exportPath}`,
      '--restore-test-reference=restore',
      '--observation-reference=observation',
      '--root-approval-reference=approval',
      '--confirm=APPLY_COMMODITY_TYPE_CODE_CONTRACT_20260819',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        DB_URL: 'postgresql://invalid:invalid@127.0.0.1:1/must_not_connect',
      },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /deploy-reference/i);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|connect/i);
  assert.equal(existsSync(exportPath), false);
});

test('contract-ready CommodityType entity no longer maps legacy code', () => {
  const source = readFileSync(ENTITY_URL, 'utf8');
  assert.doesNotMatch(source, /service_code_normalized|\bcode!:/i);
  assert.match(source, /service_name_normalized/i);
});

test('runtime zero-reference audit finds no Commodity Type code access', () => {
  const sourceRoot = fileURLToPath(new URL('../../src', import.meta.url));
  const files = walkFiles(sourceRoot).filter(
    (path) => path.endsWith('.ts') && !path.endsWith('.spec.ts'),
  );
  const forbidden =
    /commodityType\s*\??\.\s*code|commodityType\s*\[\s*['"]code['"]\s*\]|commodity_type\.code|uq_commodity_types_service_code_normalized/i;
  const references = files.flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    return forbidden.test(source) ? [path] : [];
  });
  assert.deepEqual(references, []);
});

function walkFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walkFiles(path) : [path];
  });
}

function fixture() {
  return {
    commodityTypes: [
      { id: 1, serviceTypeId: 7, code: 'IN_BAG_PACK', name: 'Bag/Pack' },
      { id: 2, serviceTypeId: 7, code: 'IN_BULK', name: 'Bulk' },
      { id: 3, serviceTypeId: 7, code: 'IN_EQUIPMENT', name: 'Equipment' },
    ],
    shippingInquiries: Array.from({ length: 7 }, (_, index) => ({
      id: index + 100,
      commodityTypeId: 2,
      cargoType: 'IN_BULK',
    })),
    epdaParameterSets: [
      {
        id: 20,
        values: {
          cargoAgencyRates: [
            {
              commodityTypeId: 1,
              typeNameSnapshot: 'Bag/Pack',
              code: 'IN_BAG_PACK',
              label: 'Bag',
              rate: 0.06,
            },
            {
              commodityTypeId: 2,
              typeNameSnapshot: 'Bulk',
              code: 'IN_BULK',
              label: 'Bulk',
              rate: 0.05,
            },
            {
              commodityTypeId: 3,
              typeNameSnapshot: 'Equipment',
              code: 'IN_EQUIPMENT',
              label: 'Equipment',
              rate: 0.1,
            },
          ],
        },
      },
    ],
    cargoTypes: [{ code: 'IN_BULK', label: 'Bulk' }],
    packageTypes: [{ id: 1, code: '20DC', displayName: "20'DC" }],
    documents: {
      booking_records: [{ id: 1, payload: { cargo: 'RICE' } }],
      arrival_notice_records: [{ id: 2, payload: { packageType: 'BAG' } }],
      delivery_order_records: [{ id: 3, payload: { packageType: 'BAG' } }],
      bill_of_lading_records: [{ id: 4, payload: { packageType: 'BAG' } }],
    },
  };
}
