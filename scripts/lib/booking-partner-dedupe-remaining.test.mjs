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
} from './booking-partner-dedupe-remaining.mjs';
import {
  assertApplyGuards,
  parseArgs,
} from '../run-booking-partner-dedupe-remaining.mjs';

const scriptsRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(
  join(
    scriptsRoot,
    'migrations/2026-08-20_booking_partner_dedupe_remaining.sql',
  ),
  'utf8',
);

test('configuration contains eight disjoint remaining pairs', () => {
  const configured = validatePairConfiguration();
  assert.equal(PARTNER_PAIRS.length, 8);
  assert.equal(configured.allIds.length, 16);
  assert.equal(configured.duplicateIds.join(','), '83,50,97,64,43,80,68,25');
});

test('merge preserves keeper identity while unioning missing data and roles', () => {
  const merged = mergePairFixture(
    {
      id: 26,
      customerId: 'VN77HOLDIN2505002',
      country: null,
      contacts: [],
      additionTypes: ['CUSTOMER'],
    },
    {
      id: 25,
      customerId: 'VN77HOLDIN2505003',
      country: 'VIETNAM',
      contacts: [{ email: 'ops@example.com' }],
      additionTypes: ['SHIPPER'],
    },
    RESOLVED_VALUES[26],
  );
  assert.equal(merged.id, 26);
  assert.equal(merged.customerId, 'VN77HOLDIN2505002');
  assert.equal(merged.customerStatus, 'WINCLIENT');
  assert.equal(merged.customerType, 'DIRECT');
  assert.deepEqual(merged.additionTypes, ['CUSTOMER', 'SHIPPER']);
});

test('English names and post-merger addresses are frozen', () => {
  assert.equal(RESOLVED_VALUES[42].customerType, 'DIRECT');
  assert.match(RESOLVED_VALUES[33].address, /BINH DONG WARD/);
  assert.match(RESOLVED_VALUES[42].address, /AN BINH WARD/);
  assert.match(RESOLVED_VALUES[109].address, /CAM LE WARD/);
  assert.equal(
    RESOLVED_VALUES[109].invoiceCompanyName,
    'PHUC THINH AGRICULTURAL MACHINERY COMPANY LIMITED',
  );
  assert.equal(RESOLVED_VALUES[108].invoiceCompanyName, 'TRUONG HUY CO., LTD');
  assert.match(RESOLVED_VALUES[108].address, /QUY NHON BAC WARD/);
  assert.match(RESOLVED_VALUES[26].address, /TAN DINH WARD/);
});

test('SQL merges values and roles before deleting exactly eight rows', () => {
  assert.match(sql, /UPDATE booking_partners AS keeper/);
  assert.match(sql, /INSERT INTO booking_partner_addition_types/);
  assert.match(sql, /ARRAY\[83, 50, 97, 64, 43, 80, 68, 25\]/);
  assert.ok(
    sql.indexOf('UPDATE booking_partners AS keeper') <
      sql.indexOf('DELETE FROM booking_partners'),
  );
});

test('checksum and destructive confirmations are deterministic and explicit', () => {
  assert.equal(
    checksumTargets([{ b: 2, a: 1 }]),
    checksumTargets([{ a: 1, b: 2 }]),
  );
  assert.match(APPLY_CONFIRMATION, /REMAINING/);
  assert.match(SIMULATE_CONFIRMATION, /REMAINING/);
});

test('apply guards fail before connection for an incorrect target', () => {
  assert.throws(
    () =>
      assertApplyGuards(
        parseArgs([
          '--apply',
          '--target-db=wrong',
          `--confirm=${APPLY_CONFIRMATION}`,
        ]),
        { database: 'postgres' },
      ),
    /target-db/,
  );
});
