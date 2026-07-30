import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationRoot = join(process.cwd(), 'scripts', 'migrations');
const expand = readFileSync(
  join(migrationRoot, '2026-07-30_epda_parameter_hardening_expand.sql'),
  'utf8',
);
const data = readFileSync(
  join(migrationRoot, '2026-07-30_epda_parameter_hardening_data.sql'),
  'utf8',
);
const validate = readFileSync(
  join(migrationRoot, '2026-07-30_epda_parameter_hardening_validate.sql'),
  'utf8',
);
const runner = readFileSync(
  join(process.cwd(), 'scripts', 'run-epda-parameter-hardening.mjs'),
  'utf8',
);

describe('EPDA parameter hardening migrations', () => {
  it('keeps expand additive and creates the required integrity structures', () => {
    expect(expand).toContain('ADD COLUMN IF NOT EXISTS version');
    expect(expand).toContain('epda_parameter_group_members');
    expect(expand).toContain('UNIQUE (port_id)');
    expect(expand).toContain('ck_epda_parameter_scope');
    expect(expand).toContain('ck_epda_parameter_values_object');
    expect(expand).toContain('ck_epda_parameter_scope_shape');
    expect(expand).toContain('fk_epda_parameter_logs_changed_by');
    expect(expand).toContain('fk_epda_parameter_logs_port');
    expect(expand).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(expand).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)\b/i);
  });

  it('normalizes membership and port area without dropping the legacy column', () => {
    expect(data).toContain('INSERT INTO epda_parameter_group_members');
    expect(data).toContain("parameter_set.scope = 'PORT'");
    expect(data).toContain('SET area = NULL');
    expect(data).toContain('Removed empty PORT override');
    expect(data).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)\b/i);
    expect(data).not.toMatch(/\bmember_port_ids\s*=\s*NULL\b/i);
  });

  it('validates final PORT area and non-empty override constraints', () => {
    expect(validate).toContain('ck_epda_parameter_area_final');
    expect(validate).toContain("(scope = 'PORT' AND area IS NULL)");
    expect(validate).toContain('ck_epda_port_override_not_empty');
    expect(validate).toContain('VALIDATE CONSTRAINT');
    expect(validate).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)\b/i);
  });

  it('keeps the runner dry by default and guards every apply', () => {
    expect(runner).toContain('apply: false');
    expect(runner).toContain('--target-db');
    expect(runner).toContain('--backup-reference');
    expect(runner).toContain('--export-dir');
    expect(runner).toContain('APPLY_EPDA_HARDENING');
    expect(runner).toContain('pg_try_advisory_lock');
    expect(runner).toContain('pg_dump');
    expect(runner).toContain("await client.query('ROLLBACK')");
  });
});
