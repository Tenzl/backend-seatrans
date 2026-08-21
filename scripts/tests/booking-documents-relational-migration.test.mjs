import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertApplyGuards, parseArgs } from '../run-booking-documents-relational-migration.mjs';

test('migration defaults to a read-only dry-run', () => {
  assert.deepEqual(parseArgs([]), { apply:false, phase:'expand', targetDb:null, confirmation:null, pgDump:null });
});

test('apply refuses missing dump and wrong target', () => {
  assert.throws(() => assertApplyGuards(parseArgs(['--apply','--target-db=wrong','--confirm=APPLY_BOOKING_RELATIONAL_EXPAND_20260821']), 'seatrans'), /target-db/);
  assert.throws(() => assertApplyGuards(parseArgs(['--apply','--target-db=seatrans','--confirm=APPLY_BOOKING_RELATIONAL_EXPAND_20260821']), 'seatrans'), /pg-dump/);
});

test('expand SQL keeps every legacy payload/generated column', () => {
  const sql = readFileSync(new URL('../migrations/2026-08-21_booking_documents_relational_expand.sql', import.meta.url),'utf8');
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN)/i);
  assert.doesNotMatch(sql, /UPDATE\s+public\./i);
  assert.match(sql, /booking_cargo_volumes/i);
  assert.match(sql, /bill_of_lading_containers/i);
  assert.match(sql, /arrival_notice_containers/i);
  assert.match(sql, /delivery_order_containers/i);
});

test('report view has one booking driving row and pre-aggregates children', () => {
  const sql = readFileSync(new URL('../migrations/2026-08-21_booking_reporting_v1.sql', import.meta.url),'utf8');
  assert.match(sql, /FROM public\.booking_records booking/i);
  assert.match(sql, /GROUP BY booking_id/i);
  assert.match(sql, /booking\.booking_flow='IMPORT'/i);
});

test('validate phase preserves legacy data and checks control totals', () => {
  const sql = readFileSync(new URL('../migrations/2026-08-21_booking_documents_relational_validate.sql', import.meta.url),'utf8');
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN)/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM/i);
  assert.match(sql, /VALIDATE CONSTRAINT/i);
  assert.match(sql, /Planned cargo quantity mismatch/i);
  assert.match(sql, /Bill container count mismatch/i);
});
