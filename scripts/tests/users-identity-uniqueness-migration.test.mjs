import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  INDEX_SPECS,
  assertSafeToApply,
  indexStatementsByName,
  isSemanticEquivalentIndex,
  parseArgs,
  summarize,
} from '../lib/users-identity-uniqueness-support.mjs';

const SCRIPT_ROOT = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const SQL_PATH = join(
  SCRIPT_ROOT,
  'migrations',
  '2026-07-30_users_identity_semantic_unique.sql',
);
const RUNNER_PATH = join(
  SCRIPT_ROOT,
  'run-users-identity-uniqueness-migration.mjs',
);

test('migration SQL contains only the three concurrent unique indexes', () => {
  const sql = readFileSync(SQL_PATH, 'utf8');
  const statements = indexStatementsByName(sql);

  assert.equal(statements.size, 3);
  assert.deepEqual(
    [...statements.keys()].sort(),
    INDEX_SPECS.map((spec) => spec.targetName).sort(),
  );
  assert.equal(
    (sql.match(/CREATE\s+UNIQUE\s+INDEX\s+CONCURRENTLY/gi) ?? []).length,
    3,
  );
  assert.doesNotMatch(
    sql.replace(/--.*$/gm, ''),
    /\b(?:ALTER|BEGIN|COMMIT|DELETE|DROP|INSERT|UPDATE)\b/i,
  );
});

test('runner arguments default to dry-run and reject unknown flags', () => {
  assert.deepEqual(parseArgs([]), {
    apply: false,
    targetDb: null,
    backupReference: null,
    logicalExport: null,
    confirmation: null,
  });
  assert.equal(parseArgs(['--apply']).apply, true);
  assert.throws(() => parseArgs(['--force']), /Unknown argument/);
});

test('runner keeps destructive capability behind explicit apply guards', () => {
  const runner = readFileSync(RUNNER_PATH, 'utf8');
  const dryRunBranch = runner.indexOf('if (!args.apply)');
  const ledgerWrite = runner.indexOf('await ensureLedger(client)');

  assert.ok(dryRunBranch >= 0);
  assert.ok(ledgerWrite > dryRunBranch);
  assert.match(runner, /BEGIN READ ONLY/);
  assert.match(runner, /pg_try_advisory_lock/);
  assert.match(runner, /--target-db must exactly match/);
  assert.match(runner, /--backup-reference is required/);
  assert.match(runner, /--logical-export must be an absolute/);
  assert.match(runner, /--confirm must equal/);
});

test('semantic detection accepts equivalent normalized and composite indexes', () => {
  const [email, username, oauthIdentity] = INDEX_SPECS;

  assert.equal(
    isSemanticEquivalentIndex(
      indexRow({
        key_expressions: ['lower(TRIM(BOTH FROM email))'],
        predicate: 'email IS NOT NULL',
      }),
      email,
    ),
    true,
  );
  assert.equal(
    isSemanticEquivalentIndex(
      indexRow({
        key_expressions: ['lower(btrim(username))'],
        predicate: "(btrim(username) <> ''::text) AND (username IS NOT NULL)",
      }),
      username,
    ),
    true,
  );
  assert.equal(
    isSemanticEquivalentIndex(
      indexRow({
        key_attribute_count: 2,
        key_expressions: [
          'lower(btrim(oauth_provider))',
          'btrim(oauth_provider_id)',
        ],
        predicate:
          "(oauth_provider_id IS NOT NULL) AND (btrim(oauth_provider_id) <> '') AND (oauth_provider IS NOT NULL) AND (btrim(oauth_provider) <> '')",
      }),
      oauthIdentity,
    ),
    true,
  );
});

test('semantic detection rejects raw email uniqueness and wrong predicates', () => {
  const [email, username] = INDEX_SPECS;

  assert.equal(
    isSemanticEquivalentIndex(
      indexRow({ key_expressions: ['email'], predicate: null }),
      email,
    ),
    false,
  );
  assert.equal(
    isSemanticEquivalentIndex(
      indexRow({
        key_expressions: ['lower(btrim(username))'],
        predicate: 'username IS NOT NULL',
      }),
      username,
    ),
    false,
  );
});

test('preflight exposes target-name conflicts and duplicate record ids', () => {
  const report = baseReport();
  report.duplicates.email = [
    {
      identity_fingerprint: '06fcb2d3fc6d77b5d2a52af2f0769a12',
      duplicate_count: 2,
      record_ids: [1, 4],
    },
  ];
  report.indexes.push(
    indexRow({
      table_name: 'other_table',
      index_name: 'uq_users_username_normalized_nonblank',
      key_expressions: ['lower(btrim(username))'],
      predicate: "username IS NOT NULL AND btrim(username) <> ''",
    }),
  );

  const summary = summarize(report);
  assert.deepEqual(summary.duplicates.email[0].record_ids, [1, 4]);
  assert.equal(summary.indexes.username.targetNameConflict.length, 1);
  assert.throws(() => assertSafeToApply(summary), /Preflight found blockers/);
});

test('preflight blocks ledger checksum drift before apply', () => {
  const report = baseReport();
  report.ledger = {
    tableExists: true,
    compatible: true,
    entry: {
      migration_id: '2026-07-30_users_identity_semantic_unique_v1',
      script_checksum: 'different-checksum',
      status: 'FAILED',
    },
  };

  const summary = summarize(report);
  assert.equal(summary.ledger.checksumMatches, false);
  assert.throws(() => assertSafeToApply(summary), /Preflight found blockers/);
});

test('preflight refuses nullable canonical email columns', () => {
  const report = baseReport();
  const email = report.columns.find((column) => column.column_name === 'email');
  email.is_nullable = 'YES';

  const summary = summarize(report);
  assert.equal(
    summary.columns.find((column) => column.name === 'email').requiredNotNull,
    false,
  );
  assert.throws(() => assertSafeToApply(summary), /Preflight found blockers/);
});

function indexRow(overrides = {}) {
  return {
    table_name: 'users',
    index_name: 'equivalent_index',
    is_unique: true,
    is_valid: true,
    is_ready: true,
    access_method: 'btree',
    key_attribute_count: 1,
    total_attribute_count: 1,
    key_expressions: [],
    predicate: null,
    definition: 'CREATE UNIQUE INDEX equivalent_index ON users',
    ...overrides,
  };
}

function baseReport() {
  return {
    tableExists: true,
    columns: [
      { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
      {
        column_name: 'email',
        data_type: 'character varying',
        is_nullable: 'NO',
      },
      {
        column_name: 'username',
        data_type: 'character varying',
        is_nullable: 'YES',
      },
      {
        column_name: 'oauth_provider',
        data_type: 'character varying',
        is_nullable: 'YES',
      },
      {
        column_name: 'oauth_provider_id',
        data_type: 'character varying',
        is_nullable: 'YES',
      },
    ],
    rowCount: 0,
    rowChecksum: 'd41d8cd98f00b204e9800998ecf8427e',
    duplicates: { email: [], username: [], oauthIdentity: [] },
    indexes: [],
    ledger: { tableExists: false, compatible: true, entry: null },
    expectedScriptChecksum: 'expected-checksum',
  };
}
