import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  mergePackageTypesFixture,
  validateContractedPostflight,
  validateMergePostflight,
} from '../run-package-types-to-freight-forwarding-types.mjs';

const projectRoot = join(import.meta.dirname, '..', '..');
const dataSqlPath = join(
  projectRoot,
  'scripts',
  'migrations',
  '2026-08-20_package_types_to_freight_forwarding_types.sql',
);
const contractSqlPath = join(
  projectRoot,
  'scripts',
  'migrations',
  '2026-08-20_drop_package_types.sql',
);
const runnerPath = join(
  projectRoot,
  'scripts',
  'run-package-types-to-freight-forwarding-types.mjs',
);

test('data SQL resolves Freight Forwarding and merges Package Types by normalized name', () => {
  const sql = readFileSync(dataSqlPath, 'utf8');
  assert.match(sql, /FREIGHT[ _-]*FORWARDING/i);
  assert.match(sql, /INSERT INTO public\.commodity_types/i);
  assert.match(sql, /FROM public\.package_types/i);
  assert.match(sql, /NOT EXISTS/i);
  assert.match(sql, /DELETE FROM public\.commodity_types/i);
  assert.match(sql, /PALLETS/i);
  assert.doesNotMatch(sql, /DROP TABLE/i);
});

test('runner protects Booking cargo volumes and document containers during the merge', () => {
  const runner = readFileSync(runnerPath, 'utf8');
  assert.match(runner, /payload -> 'cargoVolumes'/i);
  assert.match(runner, /payload -> 'containers'/i);
  assert.match(runner, /Booking-document cargo data changed/i);
});

test('fixture merge keeps existing Freight Forwarding Types and inserts each new normalized name once', () => {
  const result = mergePackageTypesFixture({
    serviceTypes: [
      { id: 1, name: 'SHIPPING AGENCY', displayName: 'Shipping Agency' },
      { id: 2, name: 'FREIGHT FORWARDING', displayName: 'Freight Forwarding' },
    ],
    commodityTypes: [
      { id: 7, serviceTypeId: 2, name: ' pallets ' },
      { id: 8, serviceTypeId: 1, name: 'CRATE(S)' },
    ],
    packageTypes: [
      { id: 10, displayName: 'PALLET(S)' },
      { id: 11, displayName: 'Crate(s)' },
      { id: 12, displayName: '  Wooden   case  ' },
      { id: 13, displayName: 'wooden case' },
    ],
  });

  assert.equal(result.freightForwardingServiceTypeId, 2);
  assert.equal(result.removedLegacyPalletsCount, 1);
  assert.deepEqual(result.insertedNames, [
    'PALLET(S)',
    'Crate(s)',
    'Wooden case',
  ]);
  assert.deepEqual(result.freightForwardingTypeNames, [
    'Crate(s)',
    'PALLET(S)',
    'Wooden case',
  ]);
});

test('postflight requires every legacy Package Type to resolve in Freight Forwarding Types', () => {
  assert.doesNotThrow(() =>
    validateMergePostflight({
      packageTypeCount: 101,
      resolvedPackageTypeCount: 101,
      unresolvedNames: [],
      normalizedDuplicateNames: [],
      legacyPalletsCount: 0,
      freightForwardingTypeCount: 101,
      legacyPalletSnapshotCount: 0,
    }),
  );
  assert.throws(
    () =>
      validateMergePostflight({
        packageTypeCount: 101,
        resolvedPackageTypeCount: 100,
        unresolvedNames: ['CRATE(S)'],
        normalizedDuplicateNames: [],
        legacyPalletsCount: 0,
        freightForwardingTypeCount: 100,
        legacyPalletSnapshotCount: 0,
      }),
    /do not resolve/i,
  );
});

test('contract SQL drops only the obsolete package_types table', () => {
  const sql = readFileSync(contractSqlPath, 'utf8');
  assert.match(sql, /DROP TABLE IF EXISTS public\.package_types/i);
  assert.doesNotMatch(sql, /commodity_types/i);
  assert.doesNotMatch(sql, /booking_records|bill_of_lading_records/i);
});

test('contract postflight requires the 101 Freight Forwarding Types and no legacy PALLETS data', () => {
  assert.doesNotThrow(() =>
    validateContractedPostflight({
      packageTypesExists: false,
      freightForwardingTypeCount: 101,
      normalizedDuplicateNames: [],
      legacyPalletsCount: 0,
      legacyPalletSnapshotCount: 0,
    }),
  );
  assert.throws(
    () =>
      validateContractedPostflight({
        packageTypesExists: false,
        freightForwardingTypeCount: 100,
        normalizedDuplicateNames: [],
        legacyPalletsCount: 0,
        legacyPalletSnapshotCount: 0,
      }),
    /Expected 101 Freight Forwarding Types/i,
  );
});
