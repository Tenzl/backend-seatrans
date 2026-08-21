import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  APPLY_CONFIRMATION,
  EXPECTED_INCREMENTAL_COUNT,
  SIMULATE_CONFIRMATION,
  checksumIncrementalRecords,
  checksumProtectedRows,
  selectNewlyReadyRecords,
  validateIncrementalRecords,
} from './legacy-ready-shipments-incremental.mjs';
import {
  assertApplyGuards,
  parseArgs,
} from '../run-legacy-ready-shipments-incremental.mjs';

const record = (shipmentId, classification = 'READY') => ({
  classification,
  shipmentId,
  flow: 'EXPORT',
  bookingNormalized: `BOOK-${shipmentId}`,
  createdByUserId: 1,
  createdAt: '2026-08-20 09:00',
  sourceChecksum: shipmentId,
  bookingPayload: {
    bookingNumber: `BOOK-${shipmentId}`,
    commodityTypeId: 177,
    commodityId: 39,
  },
  blPayload: {
    fblNumber: `BL-${shipmentId}`,
    containers: [{ type: "20'DC", grossWeight: '' }],
  },
});

test('selects only records promoted from review to ready', () => {
  const current = {
    records: [record('A'), record('B'), record('C', 'NEEDS_REVIEW')],
  };
  const baseline = {
    records: [
      record('A', 'NEEDS_REVIEW'),
      record('B', 'READY'),
      record('C', 'NEEDS_REVIEW'),
    ],
  };
  assert.deepEqual(
    selectNewlyReadyRecords(current, baseline).map(
      ({ shipmentId }) => shipmentId,
    ),
    ['A'],
  );
});

test('validation freezes 171 records and rejects overlap with migration v1', () => {
  const records = Array.from({ length: EXPECTED_INCREMENTAL_COUNT }, (_, i) =>
    record(String(i + 1)),
  );
  assert.equal(validateIncrementalRecords(records).readyCount, 171);
  assert.throws(
    () => validateIncrementalRecords(records, ['1']),
    /overlap the first migration/,
  );
  assert.throws(
    () => validateIncrementalRecords(records.slice(1)),
    /Expected 171/,
  );
});

test('checksums are deterministic and confirmations are distinct', () => {
  const left = checksumIncrementalRecords([record('2'), record('1')]);
  const right = checksumIncrementalRecords([record('1'), record('2')]);
  assert.equal(left, right);
  assert.equal(
    checksumProtectedRows([{ id: '1' }]),
    checksumProtectedRows([{ id: '1' }]),
  );
  assert.match(APPLY_CONFIRMATION, /INCREMENTAL/);
  assert.match(SIMULATE_CONFIRMATION, /INCREMENTAL/);
});

test('incremental BL containers never inherit booking gross weight', () => {
  const records = Array.from({ length: EXPECTED_INCREMENTAL_COUNT }, (_, i) =>
    record(String(i + 1)),
  );
  records[0].bookingPayload.grossWeight = '24000';
  records[0].blPayload.grossWeight = '';
  assert.equal(records[0].blPayload.containers[0].grossWeight, '');
  assert.equal(validateIncrementalRecords(records).readyCount, 171);
});

test('destructive guards reject the wrong database before connection', () => {
  const input = fileURLToPath(import.meta.url);
  const args = parseArgs([
    `--input=${input}`,
    `--baseline=${input}`,
    '--apply',
    '--target-db=wrong',
    `--confirm=${APPLY_CONFIRMATION}`,
  ]);
  assert.throws(
    () => assertApplyGuards(args, { database: 'postgres' }),
    /target-db/,
  );
});
