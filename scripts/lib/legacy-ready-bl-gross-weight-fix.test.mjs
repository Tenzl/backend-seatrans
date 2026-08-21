import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBillGrossWeightCorrection,
  checksumCorrectionTargets,
} from './legacy-ready-bl-gross-weight-fix.mjs';

function target(overrides = {}) {
  return {
    shipmentId: 'S1',
    bookingId: '35',
    billOfLadingId: '5',
    bookingPayload: { bookingNumber: 'BK-1', grossWeight: '24000' },
    blPayload: {
      fblNumber: 'HBL-1',
      grossWeight: '48000',
      measurement: '14.52',
      containers: [
        {
          type: "20'DC",
          containerNo: 'C1',
          grossWeight: '24000',
          measurement: '7.26',
        },
        {
          type: "20'DC",
          containerNo: 'C2',
          grossWeight: '24000',
          measurement: '7.26',
        },
      ],
    },
    ...overrides,
  };
}

test('keeps Booking gross weight and clears invented BL container weights', () => {
  const source = target();
  const result = buildBillGrossWeightCorrection(source);

  assert.equal(source.bookingPayload.grossWeight, '24000');
  assert.equal(result.changed, true);
  assert.equal(result.payload.grossWeight, '');
  assert.deepEqual(
    result.payload.containers.map((container) => container.grossWeight),
    ['', ''],
  );
  assert.deepEqual(
    result.payload.containers.map((container) => container.measurement),
    ['7.26', '7.26'],
  );
  assert.deepEqual(
    result.payload.containers.map((container) => container.containerNo),
    ['C1', 'C2'],
  );
});

test('refuses to erase a real per-container weight entered by an operator', () => {
  const source = target();
  source.blPayload.containers[1].grossWeight = '12000';

  assert.throws(
    () => buildBillGrossWeightCorrection(source),
    /differs from the migrated Booking gross weight/i,
  );
});

test('refuses an unexpected existing BL shipment total', () => {
  const source = target();
  source.blPayload.grossWeight = '47000';

  assert.throws(
    () => buildBillGrossWeightCorrection(source),
    /unexpected migrated BL gross weight/i,
  );
});

test('is idempotent once every BL container weight is blank', () => {
  const source = target();
  source.blPayload.grossWeight = '';
  source.blPayload.containers.forEach((container) => {
    container.grossWeight = '';
  });

  const result = buildBillGrossWeightCorrection(source);
  assert.equal(result.changed, false);
  assert.deepEqual(result.payload, source.blPayload);
});

test('clears the migrated zero total when source container weights were blank', () => {
  const source = target();
  source.bookingPayload.grossWeight = '';
  source.blPayload.grossWeight = '0';
  source.blPayload.containers.forEach((container) => {
    container.grossWeight = '';
  });

  const result = buildBillGrossWeightCorrection(source);
  assert.equal(result.changed, true);
  assert.equal(result.payload.grossWeight, '');
  assert.deepEqual(
    result.payload.containers.map((container) => container.grossWeight),
    ['', ''],
  );
});

test('target checksum is deterministic regardless of query order', () => {
  const second = target({
    shipmentId: 'S2',
    bookingId: '36',
    billOfLadingId: '6',
  });
  assert.equal(
    checksumCorrectionTargets([target(), second]),
    checksumCorrectionTargets([second, target()]),
  );
});
