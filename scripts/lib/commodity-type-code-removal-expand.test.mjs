import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  hasRetainedNonblankConstraint,
  validateCodeTransitionPostflight,
  validateCodeTransitionPreflight,
  verifyCodeTransitionStatic,
} from '../run-commodity-type-code-removal.mjs';

const SQL_URL = new URL(
  '../migrations/2026-08-19_commodity_type_code_transition_expand.sql',
  import.meta.url,
);
const RUNNER_URL = new URL(
  '../run-commodity-type-code-removal.mjs',
  import.meta.url,
);

function schemaCopy(overrides = {}) {
  return {
    tableExists: true,
    codeColumnExists: true,
    nameColumnExists: true,
    codeNullable: false,
    nameNullable: false,
    codeNonblankCheckExists: true,
    nameNonblankCheckExists: true,
    codeNormalizedUniqueExists: true,
    nameNormalizedUniqueExists: true,
    blankNameCount: 0,
    normalizedNameDuplicateCount: 0,
    rowCount: 0,
    rowChecksum: 'd41d8cd98f00b204e9800998ecf8427e',
    nameChecksum: 'd41d8cd98f00b204e9800998ecf8427e',
    ...overrides,
  };
}

test('forward-only SQL drops only code NOT NULL and is idempotent', () => {
  const sql = readFileSync(SQL_URL, 'utf8');
  const verified = verifyCodeTransitionStatic(sql);
  assert.match(sql, /ALTER TABLE public\.commodity_types/i);
  assert.match(sql, /ALTER COLUMN code DROP NOT NULL/i);
  assert.equal(verified.statementCount, 1);
  assert.equal(verified.forwardOnly, true);
});

test('static contract rejects unrelated schema or data mutations', () => {
  assert.throws(
    () =>
      verifyCodeTransitionStatic(
        'ALTER TABLE public.commodity_types DROP COLUMN code;',
      ),
    /static verification/i,
  );
  assert.throws(
    () =>
      verifyCodeTransitionStatic(
        'ALTER TABLE public.commodity_types ALTER COLUMN code DROP NOT NULL; UPDATE public.commodity_types SET name = name;',
      ),
    /static verification/i,
  );
});

test('preflight accepts legacy and already-transitioned schema copies', () => {
  assert.doesNotThrow(() => validateCodeTransitionPreflight(schemaCopy()));
  assert.doesNotThrow(() =>
    validateCodeTransitionPreflight(schemaCopy({ codeNullable: true })),
  );
});

test('constraint inspection accepts PostgreSQL varchar casts', () => {
  assert.equal(
    hasRetainedNonblankConstraint(
      [
        {
          name: 'ck_commodity_types_code_nonblank',
          type: 'c',
          definition: "CHECK (((btrim((code)::text) <> ''::text)))",
        },
      ],
      'ck_commodity_types_code_nonblank',
      'code',
    ),
    true,
  );
});

test('preflight retains code/name checks and normalized uniqueness', () => {
  for (const override of [
    { codeNonblankCheckExists: false },
    { nameNonblankCheckExists: false },
    { codeNormalizedUniqueExists: false },
    { nameNormalizedUniqueExists: false },
    { nameNullable: true },
    { blankNameCount: 1 },
    { normalizedNameDuplicateCount: 1 },
  ]) {
    assert.throws(
      () => validateCodeTransitionPreflight(schemaCopy(override)),
      /preflight blockers/i,
    );
  }
});

test('postflight passes an empty database-copy simulation', () => {
  const before = schemaCopy();
  const after = schemaCopy({ codeNullable: true });
  assert.doesNotThrow(() => validateCodeTransitionPostflight(before, after));
});

test('postflight passes a legacy-shaped populated database-copy simulation', () => {
  const before = schemaCopy({
    rowCount: 6,
    rowChecksum: 'legacy-rows',
    nameChecksum: 'legacy-names',
  });
  const after = schemaCopy({
    codeNullable: true,
    rowCount: 6,
    rowChecksum: 'legacy-rows',
    nameChecksum: 'legacy-names',
  });
  assert.doesNotThrow(() => validateCodeTransitionPostflight(before, after));
});

test('postflight rejects row/name changes and missing retained contracts', () => {
  const before = schemaCopy({
    rowCount: 6,
    rowChecksum: 'legacy-rows',
    nameChecksum: 'legacy-names',
  });
  assert.throws(
    () =>
      validateCodeTransitionPostflight(
        before,
        schemaCopy({ codeNullable: true, rowCount: 5 }),
      ),
    /rows changed/i,
  );
  assert.throws(
    () =>
      validateCodeTransitionPostflight(
        before,
        schemaCopy({
          codeNullable: true,
          rowCount: 6,
          rowChecksum: 'legacy-rows',
          nameChecksum: 'changed',
        }),
      ),
    /names changed/i,
  );
  assert.throws(
    () =>
      validateCodeTransitionPostflight(
        before,
        schemaCopy({
          codeNullable: true,
          rowCount: 6,
          rowChecksum: 'legacy-rows',
          nameChecksum: 'legacy-names',
          nameNormalizedUniqueExists: false,
        }),
      ),
    /postflight blockers/i,
  );
});

test('runner exposes guarded expand apply and read-only preflight', () => {
  const runner = readFileSync(RUNNER_URL, 'utf8');
  assert.match(runner, /--phase/);
  assert.match(runner, /BEGIN TRANSACTION READ ONLY/);
  assert.match(runner, /pg_try_advisory_lock/);
  assert.match(runner, /--target-db/);
  assert.match(runner, /--backup-reference/);
  assert.match(runner, /--logical-export/);
  assert.match(runner, /APPLY_COMMODITY_TYPE_CODE_TRANSITION_EXPAND_20260819/);
});

test('static CLI succeeds without opening a database connection', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(RUNNER_URL), '--verify-static', '--phase=expand'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        DB_URL: 'postgresql://invalid:invalid@127.0.0.1:1/must_not_connect',
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /scriptChecksum/);
  assert.match(result.stdout, /statementCount/);
});

test('importing runner is side-effect free', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(RUNNER_URL.href)})`,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        DB_URL: 'postgresql://invalid:invalid@127.0.0.1:1/must_not_connect',
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
