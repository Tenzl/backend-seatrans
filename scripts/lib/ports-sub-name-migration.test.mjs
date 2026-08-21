import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractBookingPortIdentity,
  planPortSubNames,
} from './ports-sub-name-migration.mjs';

test('extracts the selected display name and five-character port code', () => {
  assert.deepEqual(extractBookingPortIdentity('QUI NHON, VN (VNUIH)'), {
    code: 'VNUIH',
    name: 'QUI NHON',
  });
  assert.equal(extractBookingPortIdentity('CAI MEP'), null);
});

test('adds the most-used aliases only when a code resolves to one port', () => {
  const result = planPortSubNames({
    ports: [
      {
        id: 42,
        code: 'VNUIH',
        name: 'QUY NHON PORT',
        subName1: null,
        subName2: null,
      },
      {
        id: 2,
        code: 'VNSGN',
        name: 'Ho Chi Minh City',
        subName1: null,
        subName2: null,
      },
      {
        id: 61,
        code: 'VNSGN',
        name: 'Saigon',
        subName1: null,
        subName2: null,
      },
    ],
    bookingValues: [
      'QUI NHON, VN (VNUIH)',
      'QUI NHON, VN (VNUIH)',
      'QUY NHON PORT, VN (VNUIH)',
      'HO CHI MINH CITY, VN (VNSGN)',
      'CAI MEP, VN (VNTCI)',
    ],
  });

  assert.deepEqual(result.updates, [
    {
      id: 42,
      code: 'VNUIH',
      name: 'QUY NHON PORT',
      subName1: 'QUI NHON',
      subName2: null,
      added: ['QUI NHON'],
    },
  ]);
  assert.deepEqual(result.ambiguousCodes, [
    { code: 'VNSGN', portIds: [2, 61] },
  ]);
  assert.deepEqual(result.missingCodes, ['VNTCI']);
  assert.deepEqual(result.rejectedAliases, []);
});

test('preserves existing aliases and never stores more than two', () => {
  const result = planPortSubNames({
    ports: [
      {
        id: 1,
        code: 'JPNGO',
        name: 'Port of Nagoya',
        subName1: 'NAGOYA',
        subName2: null,
      },
    ],
    bookingValues: [
      'NAGOYA, AICHI, JP (JPNGO)',
      'NAGOYA, AICHI, JP (JPNGO)',
      'NAGOYA PORT, JP (JPNGO)',
    ],
  });

  assert.deepEqual(result.updates[0], {
    id: 1,
    code: 'JPNGO',
    name: 'Port of Nagoya',
    subName1: 'NAGOYA',
    subName2: 'NAGOYA, AICHI',
    added: ['NAGOYA, AICHI'],
  });
});

test('reports overlength booking values and continues with the next safe alias', () => {
  const tooLong = 'A'.repeat(101);
  const result = planPortSubNames({
    ports: [
      {
        id: 42,
        code: 'VNUIH',
        name: 'QUY NHON PORT',
        subName1: null,
        subName2: null,
      },
    ],
    bookingValues: [
      `${tooLong}, VN (VNUIH)`,
      `${tooLong}, VN (VNUIH)`,
      'QUI NHON, VN (VNUIH)',
    ],
  });

  assert.equal(result.updates[0].subName1, 'QUI NHON');
  assert.deepEqual(result.rejectedAliases, [
    {
      code: 'VNUIH',
      name: tooLong,
      length: 101,
      reason: 'MAX_LENGTH',
    },
  ]);
});
