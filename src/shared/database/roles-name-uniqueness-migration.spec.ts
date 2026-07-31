import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const projectRoot = resolve(__dirname, '..', '..', '..');
const sqlPath = join(
  projectRoot,
  'scripts',
  'migrations',
  '2026-07-30_roles_name_normalized_unique.sql',
);
const runnerPath = join(
  projectRoot,
  'scripts',
  'run-roles-name-uniqueness-migration.mjs',
);
const readmePath = join(
  projectRoot,
  'scripts',
  'migrations',
  'README-roles-name-normalized-unique.md',
);
const packageJsonPath = join(projectRoot, 'package.json');

describe('roles normalized-name uniqueness migration safety contract', () => {
  const sql = readFileSync(sqlPath, 'utf8');
  const runner = readFileSync(runnerPath, 'utf8');
  const readme = readFileSync(readmePath, 'utf8');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };

  it('is a single expand-safe concurrent unique-index statement', () => {
    const statements = sql
      .split(';')
      .map((statement) => statement.trim())
      .filter(
        (statement) =>
          statement.length > 0 &&
          !statement
            .split(/\r?\n/)
            .every((line) => line.trim().startsWith('--')),
      );

    expect(statements).toHaveLength(1);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_roles_name_normalized/i,
    );
    expect(sql).toMatch(/LOWER\s*\(\s*BTRIM\s*\(\s*name\s*\)\s*\)/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+roles\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(runner).toContain('await client.query(sql);');
    expect(runner).not.toContain("await client.query('BEGIN');");
  });

  it('defaults to read-only dry-run and reports duplicate IDs and names', () => {
    expect(runner).toContain('apply: false');
    expect(runner).toContain('BEGIN READ ONLY');
    expect(runner).toContain('normalized_name');
    expect(runner).toContain("json_build_object('id', id, 'name', name)");
    expect(runner).toContain('Preflight found blockers');
    expect(runner).toContain('duplicates: summary.duplicates');
    expect(packageJson.scripts?.['db:migrate:roles-name-uniqueness']).toBe(
      'node scripts/run-roles-name-uniqueness-migration.mjs',
    );
  });

  it('requires production guards and an immutable ledger checksum', () => {
    expect(runner).toContain('pg_try_advisory_lock');
    expect(runner).toContain("createHash('sha256')");
    expect(runner).toContain('app_schema_migrations');
    expect(runner).toContain('--target-db must exactly match');
    expect(runner).toContain('--backup-reference is required for --apply');
    expect(runner).toContain('--logical-export must be');
    expect(runner).toContain('APPLY_ROLES_NAME_NORMALIZED_UNIQUE_20260730');
  });

  it('skips a valid semantic equivalent and rejects target-name drift', () => {
    expect(runner).toContain('isSemanticEquivalentIndex');
    expect(runner).toContain('alreadyCovered');
    expect(runner).toContain(
      'Skipping index build; a valid semantic equivalent already exists.',
    );
    expect(runner).toContain('targetNameConflict');
    expect(runner).toContain('is_valid');
    expect(runner).toContain('is_ready');
  });

  it('documents dry-run, apply guards and forward-only recovery', () => {
    expect(readme).toContain('npm run db:migrate:roles-name-uniqueness');
    expect(readme).toContain('READ ONLY');
    expect(readme).toContain('provider snapshot');
    expect(readme).toContain('DROP INDEX CONCURRENTLY');
    expect(readme).toMatch(/Never edit\s+this migration/);
  });
});
