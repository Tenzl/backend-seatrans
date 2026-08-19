import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyIndependentCommodityMergeFixture,
  buildIndependentCommodityMergePlan,
  collectIndependentCommodityRecoverySnapshot,
  createIndependentCommodityRecoveryEnvelope,
  readIndependentCommodityRecoveryExport,
  summarizeIndependentCommodityState,
  validateIndependentCommodityDataPostflight,
  validateIndependentCommodityDataPreflight,
  verifyDuplicateDataApplyGuards,
  writeIndependentCommodityRecoveryExport,
} from '../run-independent-commodity-catalog-migration.mjs';

const SQL_URL = new URL(
  '../migrations/2026-08-19_independent_commodities_data.sql',
  import.meta.url,
);

test('PKE keeps ID 19 by total references, rewrites 37 and preserves text', () => {
  const beforeFixture = fixture();
  const before = summarizeIndependentCommodityState(beforeFixture);
  const plan = buildIndependentCommodityMergePlan(beforeFixture);

  assert.deepEqual(plan.mergeMap, [{ duplicateId: 37, canonicalId: 19 }]);
  assert.doesNotThrow(() =>
    validateIndependentCommodityDataPreflight(before, plan),
  );

  const afterFixture = applyIndependentCommodityMergeFixture(
    beforeFixture,
    plan,
  );
  const after = summarizeIndependentCommodityState(afterFixture);
  assert.doesNotThrow(() =>
    validateIndependentCommodityDataPostflight(before, after, plan),
  );

  assert.equal(before.commodityCount, 29);
  assert.equal(after.commodityCount, 28);
  assert.equal(after.duplicateGroups.length, 0);
  assert.equal(after.orphanReferences.length, 0);
  assert.equal(
    afterFixture.galleryImages.filter((row) => row.commodityId === 19).length,
    9,
  );
  assert.equal(afterFixture.shippingInquiries[0].commodityId, 19);
  for (const rows of Object.values(afterFixture.documents)) {
    assert.equal(rows[0].payload.commodityId, 19);
  }
  assert.equal(after.textSnapshotChecksum, before.textSnapshotChecksum);
  assert.equal(
    afterFixture.commodities.find((row) => row.id === 19).description,
    'Real PKE description',
  );
  assert.equal(
    afterFixture.commodities.find((row) => row.id === 1).description,
    null,
  );
});

test('deterministic tie-break uses the lowest ID and rerun is idempotent', () => {
  const input = fixture();
  input.galleryImages = [];
  input.shippingInquiries = [];
  input.documents = emptyDocuments();
  const firstPlan = buildIndependentCommodityMergePlan(input);
  assert.deepEqual(firstPlan.mergeMap, [{ duplicateId: 37, canonicalId: 19 }]);
  const once = applyIndependentCommodityMergeFixture(input, firstPlan);
  const secondPlan = buildIndependentCommodityMergePlan(once);
  assert.deepEqual(secondPlan.mergeMap, []);
  assert.deepEqual(
    applyIndependentCommodityMergeFixture(once, secondPlan),
    once,
  );
});

test('targeted fake-client snapshot includes every recoverable table', async () => {
  const input = fixture();
  const client = fakeClient(input);
  const snapshot = await collectIndependentCommodityRecoverySnapshot(client);
  assert.deepEqual(snapshot, input);
  assert.equal(client.queries.length, 8);
  for (const table of [
    'commodities',
    'gallery_images',
    'shipping_agency_inquiries',
    'booking_records',
    'arrival_notice_records',
    'delivery_order_records',
    'bill_of_lading_records',
  ]) {
    assert.ok(
      client.queries.some((query) => query.includes(table)),
      table,
    );
  }
});

test('recovery JSON checksum and restore round-trip are verified outside backend', () => {
  const input = fixture();
  const directory = mkdtempSync(join(tmpdir(), 'seatrans-commodity-recovery-'));
  const path = join(directory, 'recovery.json');
  const envelope = createIndependentCommodityRecoveryEnvelope(input, {
    backupReference: 'fixture-backup-20260819',
    restoreTested: true,
    rollForwardTested: true,
    restoreTestReference: 'fixture-restore-roundtrip-20260819',
    rollForwardTestReference: 'fixture-idempotent-rerun-20260819',
  });
  writeIndependentCommodityRecoveryExport(path, envelope);
  const restored = readIndependentCommodityRecoveryExport(path);
  assert.deepEqual(restored.snapshot, input);
  assert.equal(restored.checksum, envelope.checksum);
  assert.equal(restored.evidence.restoreTested, true);
  assert.equal(restored.evidence.rollForwardTested, true);
  assert.equal(
    restored.evidence.restoreTestReference,
    'fixture-restore-roundtrip-20260819',
  );
  assert.equal(
    restored.evidence.rollForwardTestReference,
    'fixture-idempotent-rerun-20260819',
  );
});

test('destructive guard refuses missing backup and recovery evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seatrans-commodity-guard-'));
  const exportPath = join(directory, 'recovery.json');
  assert.throws(
    () =>
      verifyDuplicateDataApplyGuards(
        {
          apply: true,
          targetDb: 'fixture',
          backupReference: null,
          logicalExport: exportPath,
          confirmation: 'APPLY_INDEPENDENT_COMMODITIES_DATA_20260819',
        },
        { database: 'fixture' },
      ),
    /backup-reference/i,
  );
});

test('destructive guard requires restore and roll-forward test references', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seatrans-commodity-guard-'));
  const exportPath = join(directory, 'recovery.json');
  const base = {
    apply: true,
    targetDb: 'fixture',
    backupReference: 'provider-backup-20260819',
    logicalExport: exportPath,
    confirmation: 'APPLY_INDEPENDENT_COMMODITIES_DATA_20260819',
  };
  assert.throws(
    () => verifyDuplicateDataApplyGuards(base, { database: 'fixture' }),
    /restore-test-reference/i,
  );
  assert.throws(
    () =>
      verifyDuplicateDataApplyGuards(
        { ...base, restoreTestReference: 'restore-copy-20260819' },
        { database: 'fixture' },
      ),
    /roll-forward-test-reference/i,
  );
});

test('SQL rewrites every ID surface before delete and never edits snapshots', () => {
  const sql = readFileSync(SQL_URL, 'utf8');
  assert.match(sql, /ROW_NUMBER\(\) OVER[\s\S]*total_refs DESC[\s\S]*id ASC/i);
  assert.match(sql, /UPDATE public\.gallery_images/i);
  assert.match(sql, /shipping_agency_inquiries/i);
  for (const table of [
    'booking_records',
    'arrival_notice_records',
    'delivery_order_records',
    'bill_of_lading_records',
  ]) {
    assert.match(sql, new RegExp(`UPDATE public\\.${table}`, 'i'));
  }
  assert.match(sql, /jsonb_set\([\s\S]*\{commodityId\}/i);
  assert.match(sql, /DELETE FROM public\.commodities/i);
  assert.match(sql, /upper\(btrim\(description\)\) = 'NULL'/i);
  assert.doesNotMatch(
    sql,
    /\{commodity\}|\{commodityName\}|\{descriptionOfGoods\}/i,
  );
});

function fixture() {
  const commodities = [];
  for (let id = 1; id <= 28; id += 1) {
    if (id === 19) continue;
    commodities.push({
      id,
      serviceTypeId: (id % 4) + 1,
      name: `COMMODITY_${id}`,
      displayName: `Commodity ${id}`,
      description: id === 1 ? 'NULL' : null,
    });
  }
  commodities.push(
    {
      id: 19,
      serviceTypeId: 2,
      name: ' PKE ',
      displayName: 'PKE old',
      description: 'NULL',
    },
    {
      id: 37,
      serviceTypeId: 2,
      name: 'pke',
      displayName: 'PKE duplicate',
      description: 'Real PKE description',
    },
  );
  return {
    commodities,
    galleryImages: Array.from({ length: 9 }, (_, index) => ({
      id: index + 1,
      commodityId: 19,
      imageUrl: `image-${index + 1}`,
    })),
    shippingInquiries: [
      { id: 501, commodityId: 37, cargoName: 'PKE historical text' },
    ],
    documents: Object.fromEntries(
      Object.keys(emptyDocuments()).map((table, index) => [
        table,
        [
          {
            id: 600 + index,
            payload: {
              commodityId: 37,
              commodity: 'PKE historical description',
              commodityName: 'PKE historical name',
              descriptionOfGoods: 'PKE historical goods',
            },
          },
        ],
      ]),
    ),
  };
}

function emptyDocuments() {
  return {
    booking_records: [],
    arrival_notice_records: [],
    delivery_order_records: [],
    bill_of_lading_records: [],
  };
}

function fakeClient(input) {
  const queries = [];
  return {
    queries,
    async query(sql) {
      const text = String(sql);
      queries.push(text);
      if (text.includes('information_schema.columns')) {
        return { rows: [{ exists: true }] };
      }
      if (text.includes('FROM commodities')) return { rows: input.commodities };
      if (text.includes('FROM gallery_images'))
        return { rows: input.galleryImages };
      if (text.includes('FROM shipping_agency_inquiries')) {
        return { rows: input.shippingInquiries };
      }
      for (const [table, rows] of Object.entries(input.documents)) {
        if (text.includes(`FROM ${table}`)) return { rows };
      }
      throw new Error(`Unexpected fake query: ${text}`);
    },
  };
}
