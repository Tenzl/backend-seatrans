import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('runtime schema migration contract', () => {
  const projectRoot = join(__dirname, '..', '..', '..');
  const sql = readFileSync(
    join(
      projectRoot,
      'scripts',
      'migrations',
      '2026-07-30_runtime_schema_expand.sql',
    ),
    'utf8',
  );

  it('is expand-only and creates the canonical runtime/audit tables', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS notifications/i);
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS shipping_agency_field_change_logs/i,
    );
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS booking_partner_field_change_logs/i,
    );
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS admin_audit_logs/i);
    expect(sql).toMatch(
      /GREATEST\(\s*\(SELECT last_value FROM inquiry_global_id_seq\)/i,
    );
    expect(sql).toMatch(
      /booking_document_records[\s\S]*ADD COLUMN IF NOT EXISTS status/i,
    );
    expect(sql).toMatch(
      /booking_document_records[\s\S]*ADD COLUMN IF NOT EXISTS locked_at/i,
    );
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);
  });

  it('does not retain application-startup schema bootstraps', () => {
    expect(
      existsSync(
        join(
          projectRoot,
          'src',
          'features',
          'inquiry',
          'inquiry.schema-bootstrap.ts',
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(
          projectRoot,
          'src',
          'features',
          'notification',
          'notification.schema-bootstrap.ts',
        ),
      ),
    ).toBe(false);
  });
});
