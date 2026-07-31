import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const projectRoot = resolve(__dirname, '..', '..', '..');
const sqlPath = join(
  projectRoot,
  'scripts',
  'migrations',
  '2026-07-30_relational_integrity_expand.sql',
);
const runnerPath = join(
  projectRoot,
  'scripts',
  'run-relational-integrity-expand.mjs',
);

describe('relational integrity expand migration safety contract', () => {
  const sql = readFileSync(sqlPath, 'utf8');
  const runner = readFileSync(runnerPath, 'utf8');

  it('contains only expand operations', () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+[a-z_]/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sql).toContain('ADD CONSTRAINT');
    expect(sql).toContain('NOT VALID');
  });

  it('builds every index concurrently and idempotently', () => {
    const indexStatements =
      sql.match(/CREATE (?:UNIQUE )?INDEX[\s\S]*?;/g) ?? [];

    expect(indexStatements).toHaveLength(29);
    for (const statement of indexStatements) {
      expect(statement).toMatch(
        /^CREATE (?:UNIQUE )?INDEX CONCURRENTLY IF NOT EXISTS/i,
      );
    }
    expect(sql).toContain(
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_booking_shipping_partner',
    );
  });

  it('covers the requested FK relationships', () => {
    const requiredRelationships = [
      "('booking_document_records', 'created_by_user_id', 'users'",
      "('freight_forwarding_inquiries', 'user_id', 'users'",
      "('freight_forwarding_inquiries', 'processed_by', 'users'",
      "('freight_forwarding_inquiries', 'deleted_by', 'users'",
      "('special_request_inquiries', 'user_id', 'users'",
      "('shipping_agency_inquiries', 'quoted_by_user_id', 'users'",
      "('chartering_broking_inquiries', 'processed_by', 'users'",
      "('total_logistics_inquiries', 'deleted_by', 'users'",
      "('inquiry_documents', 'uploaded_by', 'users'",
      "('booking_shipping', 'place_of_receipt_port_id', 'ports'",
      "('booking_shipping', 'port_of_loading_port_id', 'ports'",
      "('booking_shipping', 'port_of_discharge_port_id', 'ports'",
      "('booking_shipping', 'place_of_delivery_port_id', 'ports'",
      "('booking_shipping', 'final_destination_port_id', 'ports'",
      "('booking_transit_ports', 'booking_shipping_id', 'booking_shipping'",
      "('booking_transit_ports', 'port_id', 'ports'",
    ];

    for (const relationship of requiredRelationships) {
      expect(sql).toContain(relationship);
    }
  });

  it('defaults the runner to a guarded read-only audit', () => {
    expect(runner).toContain('apply: false');
    expect(runner).toContain('BEGIN READ ONLY');
    expect(runner).toContain('pg_try_advisory_lock');
    expect(runner).toContain("createHash('sha256')");
    expect(runner).toContain('app_schema_migrations');
    expect(runner).toContain('semanticEquivalent');
    expect(runner).toContain('--target-db must exactly match');
    expect(runner).toContain('--backup-reference is required');
    expect(runner).toContain('--logical-export must be');
    expect(runner).toContain('APPLY_RELATIONAL_INTEGRITY_EXPAND_20260730');
  });

  it('is isolated from the active runtime-schema migration files', () => {
    expect(runner).not.toContain('run-runtime-schema-migration.mjs');
    expect(runner).not.toContain('2026-07-30_runtime_schema_expand.sql');
  });
});
