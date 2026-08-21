import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cargoVolumesFromPayload,
  containersFromPayload,
  parseLegacyNumber,
  presentationFromPayload,
  scalarProjection,
} from './booking-documents-relational.mjs';

test('keeps exact legacy numeric text and extracts report number', () => {
  assert.deepEqual(parseLegacyNumber("24,000 KGS/20'"), {
    value: 24000,
    raw: "24,000 KGS/20'",
  });
  assert.deepEqual(parseLegacyNumber('Nil'), { value: null, raw: 'Nil' });
});

test('presentation whitelist excludes relational and repeated data', () => {
  assert.deepEqual(
    presentationFromPayload({
      descriptionOfGoods: 'STONE',
      shippingMark: 'N/M',
      bookingNumber: 'BK-1',
      clientPartyId: 4,
      containers: [{ type: "20'DC" }],
    }),
    { descriptionOfGoods: 'STONE', shippingMark: 'N/M' },
  );
});

test('cargo volumes contain no zero or blank placeholder rows', () => {
  assert.deepEqual(
    cargoVolumesFromPayload({ cargoVolumes: { "20'DC": 2, "40'HC": 0, '': 5 } }),
    [{ containerTypeCode: "20'DC", quantity: 2, rowOrder: 0 }],
  );
});

test('container rows drop placeholders and retain a meaningful first row', () => {
  const rows = containersFromPayload({
    containers: [
      {},
      { type: "20'DC", grossWeight: '12,000', packageType: 'BAGS', note: 'A' },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rowOrder, 0);
  assert.equal(rows[0].containerTypeCode, "20'DC");
  assert.equal(rows[0].grossWeightKg, 12000);
  assert.deepEqual(rows[0].presentation, { note: 'A' });
});

test('booking projection separates report fields from presentation', () => {
  const projection = scalarProjection('booking', {
    bookingNumber: 'BK-1', date: '2026-08-21', clientPartyId: 5,
    grossWeight: "24000 KGS/20'", descriptionOfGoods: 'STONE',
  });
  assert.equal(projection.documentNumber, 'BK-1');
  assert.equal(projection.clientPartyId, 5);
  assert.equal(projection.grossWeightKg, 24000);
  assert.equal(projection.grossWeightRaw, "24000 KGS/20'");
  assert.deepEqual(projection.presentationPayload, { descriptionOfGoods: 'STONE' });
});
