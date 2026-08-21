import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checksumReadyRecords,
  selectReadyRecords,
  toCreatedAt,
  validateReadyRecords,
} from './legacy-ready-shipments-migration.mjs';

const ready = (overrides = {}) => ({
  classification: 'READY',
  shipmentId: 'S1',
  flow: 'EXPORT',
  bookingNormalized: 'BOOKING-1',
  createdByUserId: 11,
  createdAt: '2026-08-20 10:30',
  sourceChecksum: 'source',
  bookingPayload: {
    bookingNumber: 'BOOKING-1',
    commodityTypeId: 177,
    commodityId: 39,
  },
  blPayload: { fblNumber: 'HBL-1', containers: [{ type: "20'DC" }] },
  ...overrides,
});

test('selects only READY rows and validates the canonical identities', () => {
  const records = selectReadyRecords({
    records: [ready(), { classification: 'NEEDS_REVIEW' }],
  });
  assert.equal(records.length, 1);
  assert.equal(validateReadyRecords(records).readyCount, 1);
});

test('rejects duplicate booking numbers and duplicate HBL numbers', () => {
  assert.throws(
    () => validateReadyRecords([ready(), ready({ shipmentId: 'S2' })]),
    /duplicate Booking No/i,
  );
});

test('checksum is deterministic regardless of input order', () => {
  const second = ready({
    shipmentId: 'S2',
    bookingNormalized: 'BOOKING-2',
    bookingPayload: {
      bookingNumber: 'BOOKING-2',
      commodityTypeId: 177,
      commodityId: 39,
    },
    blPayload: { fblNumber: 'HBL-2', containers: [{ type: "20'DC" }] },
  });
  assert.equal(
    checksumReadyRecords([ready(), second]),
    checksumReadyRecords([second, ready()]),
  );
});

test('normalizes source local time with an explicit Bangkok offset', () => {
  assert.equal(toCreatedAt('2026-08-20 10:30'), '2026-08-20 10:30:00+07:00');
  assert.throws(() => toCreatedAt('not-a-date'), /Invalid createdAt/);
});
