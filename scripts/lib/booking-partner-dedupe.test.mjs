import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPLY_CONFIRMATION,
  PARTNER_PAIRS,
  RESOLVED_VALUES,
  SIMULATE_CONFIRMATION,
  checksumTargets,
  mergePairFixture,
  validatePairConfiguration,
} from './booking-partner-dedupe.mjs';
import {
  assertApplyGuards,
  parseArgs,
} from '../run-booking-partner-dedupe.mjs';

const scriptsRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(
  join(scriptsRoot, 'migrations/2026-08-20_booking_partner_dedupe.sql'),
  'utf8',
);

test('configuration contains ten disjoint keeper/duplicate pairs', () => {
  const configured = validatePairConfiguration();
  assert.equal(PARTNER_PAIRS.length, 10);
  assert.equal(configured.allIds.length, 20);
  assert.equal(
    configured.duplicateIds.join(','),
    '39,122,11,37,90,31,94,28,92,95',
  );
});

test('merge copies blanks, unions contacts/types, and preserves keeper identity', () => {
  const merged = mergePairFixture(
    {
      id: 30,
      customerId: 'NHATPHUCO.2504004',
      name: 'NHAT PHU CO., LTD',
      phone: null,
      contacts: [{ person: 'A', email: 'a@example.com' }],
      additionTypes: ['SHIPPER'],
    },
    {
      id: 90,
      customerId: 'ZL1JKM0034',
      name: 'NHAT PHU CO., LTD',
      phone: '842563741168',
      contacts: [{ email: 'a@example.com', person: 'A' }, { person: 'B' }],
      additionTypes: ['CUSTOMER', 'CONSIGNEE', 'SHIPPER'],
    },
    RESOLVED_VALUES[30],
  );
  assert.equal(merged.id, 30);
  assert.equal(merged.customerId, 'NHATPHUCO.2504004');
  assert.equal(merged.phone, '842563741168');
  assert.deepEqual(merged.additionTypes, ['CONSIGNEE', 'CUSTOMER', 'SHIPPER']);
  assert.equal(merged.contacts.length, 2);
  assert.match(merged.address, /QUY NHON BAC WARD/);
});

test('all user conflict decisions are frozen in configuration', () => {
  assert.equal(
    RESOLVED_VALUES[111].invoiceCompanyName,
    'HOANG THACH SON COMPANY LTD',
  );
  assert.match(RESOLVED_VALUES[111].invoiceCompanyAddress, /TUY PHUOC COMMUNE/);
  assert.equal(RESOLVED_VALUES[2].customerStatus, 'LEAD');
  assert.match(RESOLVED_VALUES[19].address, /QUY NHON TAY WARD/);
  assert.equal(RESOLVED_VALUES[30].city, 'Quy Nhon');
  assert.equal(RESOLVED_VALUES[75].customerType, 'DIRECT');
  assert.equal(RESOLVED_VALUES[13].name, 'HONGC USING ENTERPRISE CO., LTD.');
  assert.equal(RESOLVED_VALUES[23].name, 'MIKUNI SANGYO CO., LTD');
});

test('SQL merges values/types before deleting exactly ten duplicates', () => {
  assert.match(sql, /UPDATE booking_partners AS keeper/);
  assert.match(sql, /INSERT INTO booking_partner_addition_types/);
  assert.match(sql, /DELETE FROM booking_partners/);
  assert.match(sql, /ARRAY\[39, 122, 11, 37, 90, 31, 94, 28, 92, 95\]/);
  assert.ok(
    sql.indexOf('UPDATE booking_partners AS keeper') <
      sql.indexOf('DELETE FROM booking_partners'),
  );
  assert.ok(
    sql.indexOf('INSERT INTO booking_partner_addition_types') <
      sql.indexOf('DELETE FROM booking_partners'),
  );
});

test('checksum is deterministic and apply confirmation is explicit', () => {
  const left = checksumTargets([{ b: 2, a: 1 }]);
  const right = checksumTargets([{ a: 1, b: 2 }]);
  assert.equal(left, right);
  assert.equal(APPLY_CONFIRMATION, 'APPLY_BOOKING_PARTNER_DEDUPE_20260820');
  assert.equal(
    SIMULATE_CONFIRMATION,
    'SIMULATE_BOOKING_PARTNER_DEDUPE_20260820',
  );
});

test('apply and simulation guards refuse wrong target or confirmation before connect', () => {
  const config = { database: 'postgres' };
  assert.throws(
    () =>
      assertApplyGuards(
        parseArgs([
          '--apply',
          '--target-db=wrong',
          `--confirm=${APPLY_CONFIRMATION}`,
        ]),
        config,
      ),
    /target-db/,
  );
  assert.throws(
    () =>
      assertApplyGuards(
        parseArgs(['--simulate', '--target-db=postgres', '--confirm=WRONG']),
        config,
      ),
    /SIMULATE_BOOKING_PARTNER_DEDUPE_20260820/,
  );
});
