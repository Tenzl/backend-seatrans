import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

describe('booking workflow migration', () => {
  const runner = join(process.cwd(), 'scripts', 'apply-booking-workflows.mjs');
  const sql = readFileSync(
    join(
      process.cwd(),
      'scripts',
      'migrations',
      '2026-08-03_booking_workflows.sql',
    ),
    'utf8',
  );
  const purgeSql = readFileSync(
    join(
      process.cwd(),
      'scripts',
      'migrations',
      '2026-08-03_purge_booking_document_history.sql',
    ),
    'utf8',
  );

  it('adds the direction and root-booking relationship', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS booking_flow/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS booking_id/i);
    expect(sql).toMatch(/FOREIGN KEY \(booking_id\)[\s\S]*ON DELETE CASCADE/i);
    expect(sql).toMatch(/ck_booking_document_records_workflow_shape/i);
  });

  it('prevents duplicate active workflow steps', () => {
    expect(sql).toMatch(
      /UNIQUE INDEX IF NOT EXISTS uq_booking_document_records_active_step/i,
    );
    expect(sql).toMatch(/\(booking_id, document_type\)/i);
  });

  it('keeps the explicitly requested irreversible history purge separate', () => {
    expect(purgeSql).toMatch(
      /TRUNCATE TABLE booking_document_records RESTART IDENTITY/i,
    );
    expect(sql).not.toMatch(/TRUNCATE TABLE/i);
  });

  it('defaults to dry-run and rejects a mismatched apply target', () => {
    const dryRun = spawnSync(process.execPath, [runner], {
      encoding: 'utf8',
      env: { ...process.env, DB_URL: '', DB_DATABASE: 'booking_review_test' },
    });
    expect(dryRun.status).toBe(0);
    expect(dryRun.stdout).toContain('Dry-run only');

    const rejected = spawnSync(
      process.execPath,
      [
        runner,
        '--apply',
        '--target-db=wrong_database',
        '--confirm=APPLY_BOOKING_WORKFLOWS_20260803',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, DB_URL: '', DB_DATABASE: 'booking_review_test' },
      },
    );
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain(
      '--target-db must exactly match the configured database name',
    );
  });

  it('requires the stronger confirmation before purging history', () => {
    const rejected = spawnSync(
      process.execPath,
      [
        runner,
        '--apply',
        '--purge-history',
        '--target-db=booking_review_test',
        '--confirm=APPLY_BOOKING_WORKFLOWS_20260803',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, DB_URL: '', DB_DATABASE: 'booking_review_test' },
      },
    );
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain(
      'PURGE_HISTORY_AND_APPLY_BOOKING_WORKFLOWS_20260803',
    );
  });
});
