import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  checksumSnapshot,
  parseArgs,
  readAndVerifyBackup,
  verifyGuards,
} from '../export-commodity-catalog-backup.mjs';

test('backup scope includes complete EPDA parameter recovery data', () => {
  const exporterSource = readFileSync(
    new URL('../export-commodity-catalog-backup.mjs', import.meta.url),
    'utf8',
  );
  assert.match(exporterSource, /'epda_parameter_set'/);

  const directory = mkdtempSync(join(tmpdir(), 'catalog-backup-'));
  const output = join(directory, 'backup.json');
  const snapshot = {
    identity: { database: 'postgres' },
    tables: {
      epda_parameter_set: {
        exists: true,
        columns: [
          {
            column_name: 'values',
            data_type: 'jsonb',
            udt_name: 'jsonb',
            is_nullable: 'NO',
            column_default: null,
          },
        ],
        constraints: [
          {
            conname: 'epda_parameter_set_pkey',
            contype: 'p',
            definition: 'PRIMARY KEY (id)',
          },
        ],
        indexes: [
          {
            indexname: 'epda_parameter_set_pkey',
            indexdef:
              'CREATE UNIQUE INDEX epda_parameter_set_pkey ON public.epda_parameter_set USING btree (id)',
          },
        ],
        rows: [
          {
            id: 1,
            scope: 'AREA',
            area: '1',
            values: {
              cargoAgencyRates: [
                {
                  commodityTypeId: 11,
                  typeNameSnapshot: 'Bulk cargo',
                  label: 'Bulk cargo',
                  rate: 0.08,
                },
              ],
            },
          },
        ],
      },
    },
  };
  const checksum = checksumSnapshot(snapshot);
  writeFileSync(
    output,
    JSON.stringify({
      format: 'seatrans-commodity-catalog-backup-v1',
      checksum,
      snapshot,
      evidence: { restoreTestReference: 'verified-epda-restore-test' },
    }),
  );

  const verified = readAndVerifyBackup(output);
  assert.deepEqual(
    verified.snapshot.tables.epda_parameter_set,
    snapshot.tables.epda_parameter_set,
  );
  assert.equal(verified.checksum, checksum);

  snapshot.tables.epda_parameter_set.rows[0].values.cargoAgencyRates[0].rate = 0.09;
  writeFileSync(
    output,
    JSON.stringify({
      format: 'seatrans-commodity-catalog-backup-v1',
      checksum,
      snapshot,
      evidence: { restoreTestReference: 'verified-epda-restore-test' },
    }),
  );
  assert.throws(() => readAndVerifyBackup(output), /checksum mismatch/);
});

test('backup CLI requires exact target, confirmation and external output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'catalog-backup-'));
  const output = join(directory, 'backup.json');
  const args = parseArgs([
    `--output=${output}`,
    '--target-db=postgres',
    '--confirm=CREATE_COMMODITY_CATALOG_BACKUP_20260819',
    '--restore-test-reference=scripts/lib/commodity-catalog-backup.test.mjs',
  ]);
  assert.equal(verifyGuards(args, { database: 'postgres' }), output);
  assert.throws(
    () =>
      verifyGuards({ ...args, targetDb: 'wrong' }, { database: 'postgres' }),
    /target-db/,
  );
});

test('backup verifier rejects checksum corruption', () => {
  const directory = mkdtempSync(join(tmpdir(), 'catalog-backup-'));
  const output = join(directory, 'backup.json');
  const snapshot = { identity: { database: 'postgres' }, tables: {} };
  writeFileSync(
    output,
    JSON.stringify({
      format: 'seatrans-commodity-catalog-backup-v1',
      checksum: checksumSnapshot(snapshot),
      snapshot,
      evidence: { restoreTestReference: 'verified-test' },
    }),
  );
  assert.equal(
    readAndVerifyBackup(output).checksum,
    checksumSnapshot(snapshot),
  );
  const corrupted = { ...snapshot, tables: { commodities: [] } };
  writeFileSync(
    output,
    JSON.stringify({
      format: 'seatrans-commodity-catalog-backup-v1',
      checksum: checksumSnapshot(snapshot),
      snapshot: corrupted,
      evidence: { restoreTestReference: 'verified-test' },
    }),
  );
  assert.throws(() => readAndVerifyBackup(output), /checksum mismatch/);
});
