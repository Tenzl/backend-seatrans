import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  createCommodityContractRecoveryEnvelope,
  readCommodityContractRecoveryExport,
  writeCommodityContractRecoveryExport,
} from '../run-independent-commodity-catalog-migration.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = process.cwd();
const sql = readFileSync(
  join(root, 'scripts/migrations/2026-08-19_commodity_groups_contract.sql'),
  'utf8',
);
const runner = readFileSync(
  join(root, 'scripts/run-independent-commodity-catalog-migration.mjs'),
  'utf8',
);
const entity = readFileSync(
  join(root, 'src/features/commodities/entities/commodity.entity.ts'),
  'utf8',
);
const moduleSource = readFileSync(
  join(root, 'src/features/commodities/commodities.module.ts'),
  'utf8',
);
const executableSql = sql.replace(/--.*$/gm, '');

test('contract SQL drops only the approved Commodity legacy objects', () => {
  assert.match(
    executableSql,
    /ALTER TABLE public\.commodities[\s\S]*DROP COLUMN group_id[\s\S]*DROP COLUMN required_image_count[\s\S]*DROP COLUMN cargo_type\s*;/i,
  );
  assert.match(executableSql, /DROP TABLE public\.commodity_groups\s*;/i);
  assert.match(
    executableSql,
    /CREATE UNIQUE INDEX uq_commodities_service_name_normalized/i,
  );
  assert.doesNotMatch(executableSql, /\bCASCADE\b/i);
  assert.doesNotMatch(executableSql, /\b(?:UPDATE|INSERT|DELETE|TRUNCATE)\b/i);
  assert.doesNotMatch(executableSql, /\b(?:cargo_types|package_types)\b/i);
  assert.equal(
    (executableSql.match(/\bDROP\s+(?:COLUMN|TABLE)\b/gi) ?? []).length,
    4,
  );
});

test('contract runner has explicit destructive refusal gates', () => {
  assert.match(runner, /'contract'/);
  assert.match(runner, /--backup-reference is required for contract --apply/);
  assert.match(runner, /--logical-export is required for contract --apply/);
  assert.match(
    runner,
    /--observation-reference is required for contract --apply/,
  );
  assert.match(
    runner,
    /--restore-test-reference is required for contract --apply/,
  );
  assert.match(runner, /APPLY_COMMODITY_GROUPS_CONTRACT_20260819/);
  assert.match(runner, /validateCommodityContractPreflight/);
  assert.match(runner, /validateCommodityContractPostflight/);
  assert.match(runner, /pg_try_advisory_lock/);
  const lockAt = runner.indexOf(
    'LOCK TABLE public.commodities, public.commodity_groups',
  );
  const collectAt = runner.lastIndexOf(
    'await collectCommodityContractRecoverySnapshot(client)',
  );
  const applyAt = runner.lastIndexOf('await client.query(sql)');
  assert.ok(lockAt > -1 && lockAt < collectAt && collectAt < applyAt);
});

test('targeted contract recovery envelope verifies checksum and restore evidence', () => {
  const snapshot = {
    commodityGroups: [{ id: 1, service_type_id: 2, name: 'BULK' }],
    commoditiesLegacy: [
      {
        id: 19,
        service_type_id: 2,
        group_id: 1,
        required_image_count: 18,
        cargo_type: 'IN_BULK',
      },
    ],
    schema: {
      columns: [{ table_name: 'commodities', column_name: 'group_id' }],
      constraints: [{ conname: 'fk_commodities_group' }],
      indexes: [{ indexname: 'uq_commodities_group_name' }],
    },
  };
  const envelope = createCommodityContractRecoveryEnvelope(snapshot, {
    backupReference: 'provider-backup-20260819',
    observationReference: 'observation-approved-20260819',
    restoreTestReference: 'restore-test-copy-20260819',
  });
  const directory = mkdtempSync(join(tmpdir(), 'commodity-contract-'));
  const path = join(directory, 'recovery.json');
  writeCommodityContractRecoveryExport(path, envelope);
  assert.deepEqual(readCommodityContractRecoveryExport(path), envelope);

  const corrupted = { ...envelope, checksum: 'invalid' };
  const corruptPath = join(directory, 'corrupt.json');
  writeFileSync(corruptPath, JSON.stringify(corrupted));
  assert.throws(
    () => readCommodityContractRecoveryExport(corruptPath),
    /checksum mismatch/i,
  );
});

test('contract locks mutable tables before collecting the recovery snapshot', () => {
  const contractRunner = runner.slice(
    runner.indexOf('async function runCommodityContractMigration'),
    runner.indexOf('async function main()'),
  );
  const advisoryLock = contractRunner.indexOf('pg_try_advisory_lock');
  const tableLock = contractRunner.indexOf(
    'LOCK TABLE public.commodities, public.commodity_groups',
  );
  const recoverySnapshot = contractRunner.indexOf(
    'collectCommodityContractRecoverySnapshot(client)',
  );
  const contractSql = contractRunner.indexOf('await client.query(sql)');

  assert.ok(advisoryLock >= 0, 'advisory lock is required');
  assert.ok(tableLock > advisoryLock, 'table lock must follow advisory lock');
  assert.ok(
    recoverySnapshot > tableLock,
    'recovery snapshot must be collected after table locks',
  );
  assert.ok(contractSql > recoverySnapshot, 'DROP SQL must follow the export');
});

test('Commodity runtime no longer maps or registers Group and quota fields', () => {
  assert.doesNotMatch(
    entity,
    /CommodityGroup|groupId|group_id|requiredImageCount|required_image_count|cargoType|cargo_type/,
  );
  assert.doesNotMatch(
    moduleSource,
    /CommodityGroup|commodity-groups|commodityGroupsService/,
  );
});
