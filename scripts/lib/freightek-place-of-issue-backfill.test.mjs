import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPlaceOfIssuePlan,
  extractPlaceOfIssueEntries,
} from './freightek-place-of-issue-backfill.mjs';

function sourceEntry({
  bookingNo = 'BK-001',
  shipmentId = 'S2600001',
  hbl = 'ST2600001',
  mode = 'ORIGIN',
  place = 'QUI NHON, VN (VNUIH)',
} = {}) {
  return {
    status: 'success',
    bookingNo,
    shipmentId,
    hbl,
    pageSnapshot: {
      sections: [
        {
          name: 'Details',
          fields: [
            {
              name: 'B/L Place of issue',
              controls: [
                { type: 'text', value: mode },
                { type: 'textarea', value: place },
              ],
            },
          ],
        },
      ],
    },
  };
}

test('extracts the live textarea value and preserves blank source rows', () => {
  const result = extractPlaceOfIssueEntries({
    entries: [
      sourceEntry(),
      sourceEntry({
        bookingNo: 'BK-002',
        shipmentId: 'S2600002',
        hbl: 'ST2600002',
        place: '',
      }),
    ],
  });

  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    bookingNo: 'BK-001',
    shipmentId: 'S2600001',
    hbl: 'ST2600001',
    mode: 'ORIGIN',
    placeOfIssue: 'QUI NHON, VN (VNUIH)',
  });
  assert.equal(result[1].placeOfIssue, '');
});

test('plans exact Booking/HBL updates and skips blank source values', () => {
  const sources = extractPlaceOfIssueEntries({
    entries: [
      sourceEntry(),
      sourceEntry({
        bookingNo: 'BK-002',
        shipmentId: 'S2600002',
        hbl: 'ST2600002',
        place: '',
      }),
    ],
  });
  const plan = buildPlaceOfIssuePlan(sources, [
    {
      bookingId: '10',
      bookingNumber: 'BK-001',
      bookingPayload: { portOfLoading: 'DA NANG' },
      billId: '20',
      fblNumber: 'ST2600001',
      billPayload: {},
    },
    {
      bookingId: '11',
      bookingNumber: 'BK-002',
      bookingPayload: {},
      billId: '21',
      fblNumber: 'ST2600002',
      billPayload: {},
    },
  ]);

  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.deepEqual(plan.updates[0], {
    bookingId: '10',
    billId: '20',
    bookingNumber: 'BK-001',
    shipmentId: 'S2600001',
    fblNumber: 'ST2600001',
    placeOfIssue: 'QUI NHON, VN (VNUIH)',
  });
  assert.equal(plan.blankSourceCount, 1);
});

test('refuses missing, duplicate, HBL mismatch, and nonblank conflicts', () => {
  const sources = extractPlaceOfIssueEntries({ entries: [sourceEntry()] });
  const cases = [
    [],
    [
      {
        bookingId: '10',
        bookingNumber: 'BK-001',
        bookingPayload: {},
        billId: '20',
        fblNumber: 'ST2600001',
        billPayload: {},
      },
      {
        bookingId: '11',
        bookingNumber: 'BK-001',
        bookingPayload: {},
        billId: '21',
        fblNumber: 'ST2600001',
        billPayload: {},
      },
    ],
    [
      {
        bookingId: '10',
        bookingNumber: 'BK-001',
        bookingPayload: {},
        billId: '20',
        fblNumber: 'OTHER',
        billPayload: {},
      },
    ],
    [
      {
        bookingId: '10',
        bookingNumber: 'BK-001',
        bookingPayload: { placeOfIssue: 'USER BOOKING VALUE' },
        billId: '20',
        fblNumber: 'ST2600001',
        billPayload: { placeOfIssue: 'USER BL VALUE' },
      },
    ],
  ];

  for (const databaseRows of cases) {
    assert.ok(buildPlaceOfIssuePlan(sources, databaseRows).blockers.length > 0);
  }
});
