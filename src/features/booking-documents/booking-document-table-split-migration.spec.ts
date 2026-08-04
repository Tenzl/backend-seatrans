import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

describe('booking document table split migration', () => {
  const root = process.cwd();
  const runner = join(root, 'scripts', 'run-booking-document-table-split.mjs');
  const sql = readFileSync(
    join(
      root,
      'scripts',
      'migrations',
      '2026-08-04_split_booking_document_records.sql',
    ),
    'utf8',
  );
  const rollback = readFileSync(
    join(
      root,
      'scripts',
      'migrations',
      '2026-08-04_split_booking_document_records_rollback.sql',
    ),
    'utf8',
  );
  const support = readFileSync(
    join(root, 'scripts', 'lib', 'booking-document-table-split-support.mjs'),
    'utf8',
  );

  it('creates exactly four typed tables and removes the legacy table safely', () => {
    for (const table of [
      'booking_records',
      'arrival_notice_records',
      'delivery_order_records',
      'bill_of_lading_records',
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE ${table}`, 'i'));
    }
    expect(sql).toMatch(/DROP TABLE booking_document_records\s*;/i);
    expect(sql).not.toMatch(/DROP TABLE booking_document_records CASCADE/i);
  });

  it('rejects any destructive run outside the approved 14-row distribution', () => {
    expect(sql).toMatch(/total_count\s*<>\s*14/i);
    expect(sql).toMatch(/booking_count\s*<>\s*5/i);
    expect(sql).toMatch(/an_count\s*<>\s*5/i);
    expect(sql).toMatch(/do_count\s*<>\s*2/i);
    expect(sql).toMatch(/bl_count\s*<>\s*2/i);
    expect(support).toContain('total: 14');
  });

  it('uses generated search columns and PROCESSING lifecycle defaults', () => {
    expect(sql).toMatch(
      /booking_number[\s\S]*GENERATED ALWAYS AS \(payload ->> 'bookingNumber'\) STORED/i,
    );
    expect(sql).toMatch(
      /an_number[\s\S]*GENERATED ALWAYS AS \(payload ->> 'anNumber'\) STORED/i,
    );
    expect(sql).toMatch(
      /do_number[\s\S]*GENERATED ALWAYS AS \(payload ->> 'doNumber'\) STORED/i,
    );
    expect(sql).toMatch(
      /fbl_number[\s\S]*GENERATED ALWAYS AS \(payload ->> 'fblNumber'\) STORED/i,
    );
    expect(sql.match(/DEFAULT 'PROCESSING'/gi)).toHaveLength(4);
  });

  it('keeps document-number indexes non-unique and booking links unique while active', () => {
    expect(sql).toMatch(/CREATE INDEX idx_booking_records_booking_number/i);
    expect(sql).toMatch(/CREATE INDEX idx_arrival_notice_records_an_number/i);
    expect(sql).toMatch(/CREATE INDEX idx_delivery_order_records_do_number/i);
    expect(sql).toMatch(/CREATE INDEX idx_bill_of_lading_records_fbl_number/i);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX uq_arrival_notice_records_active_booking/i,
    );
    expect(sql).toMatch(
      /FOREIGN KEY \(booking_id\)[\s\S]*REFERENCES booking_records\(id\)[\s\S]*ON DELETE CASCADE/i,
    );
  });

  it('documents the schema-only rollback as data-irreversible', () => {
    expect(rollback).toMatch(/DATA IS IRREVERSIBLE/i);
    expect(rollback).toMatch(/split_row_count\s*<>\s*0/i);
    expect(rollback).toMatch(/CREATE TABLE booking_document_records/i);
    expect(rollback).not.toMatch(/DROP TABLE [^;]+ CASCADE/i);
  });

  it('requires the exact target database and destructive confirmation', () => {
    const missingTarget = spawnSync(process.execPath, [runner], {
      encoding: 'utf8',
      env: { ...process.env, DB_DATABASE: 'booking_split_test' },
    });
    expect(missingTarget.status).toBe(1);
    expect(missingTarget.stderr).toContain(
      '--target-db must exactly match the configured database name',
    );

    const wrongConfirmation = spawnSync(
      process.execPath,
      [runner, '--apply', '--target-db=booking_split_test', '--confirm=WRONG'],
      {
        encoding: 'utf8',
        env: { ...process.env, DB_DATABASE: 'booking_split_test' },
      },
    );
    expect(wrongConfirmation.status).toBe(1);
    expect(wrongConfirmation.stderr).toContain(
      'DELETE_14_AND_SPLIT_BOOKING_DOCUMENTS_20260804',
    );
  });
});
