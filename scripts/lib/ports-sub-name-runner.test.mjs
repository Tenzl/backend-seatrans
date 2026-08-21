import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseArgs,
  verifyExpandSql,
  writeBackupExclusive,
} from '../run-ports-sub-name-migration.mjs';

test('expand SQL is additive and creates exactly two nullable aliases', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'scripts',
      'migrations',
      '2026-08-21_ports_sub_names_expand.sql',
    ),
    'utf8',
  );
  assert.equal(verifyExpandSql(sql), true);
});

test('parses separate guarded expand and data phases', () => {
  assert.deepEqual(parseArgs(['--dry-run', '--phase=data']), {
    mode: 'dry-run',
    phase: 'data',
    targetDb: null,
    backupReference: null,
    logicalExport: null,
    confirmation: null,
  });
  assert.throws(() => parseArgs(['--phase=all']), /invalid argument/);
});

test('backfill is scoped to active booking records and verifies every update', () => {
  const runner = readFileSync(
    join(process.cwd(), 'scripts', 'run-ports-sub-name-migration.mjs'),
    'utf8',
  );

  assert.match(runner, /FROM public\.\$\{BOOKING_SOURCE_TABLE\} AS booking/);
  assert.match(runner, /booking\.deleted_at IS NULL/);
  assert.doesNotMatch(runner, /const DOCUMENT_TABLES/);
  assert.match(runner, /result\.rowCount !== 1/);
  assert.match(runner, /Data postflight failed/);
  assert.match(runner, /migration_id AS id/);
  assert.match(runner, /script_checksum AS checksum/);
  assert.match(runner, /status = 'SUCCEEDED'/);
  assert.doesNotMatch(runner, /app_schema_migrations\(id, checksum\)/);
  assert.match(runner, /openSync\(temporaryPath, 'wx'/);
  assert.match(runner, /linkSync\(temporaryPath, path\)/);
  assert.match(runner, /BEGIN ISOLATION LEVEL REPEATABLE READ/);
});

test('logical backup is atomically published and never overwritten', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ports-sub-name-backup-'));
  const backup = join(directory, 'backup.json');
  try {
    writeBackupExclusive(backup, { version: 1 });
    assert.equal(existsSync(backup), true);
    assert.deepEqual(JSON.parse(readFileSync(backup, 'utf8')), { version: 1 });
    assert.throws(() => writeBackupExclusive(backup, { version: 2 }), /EEXIST/);
    assert.deepEqual(JSON.parse(readFileSync(backup, 'utf8')), { version: 1 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
