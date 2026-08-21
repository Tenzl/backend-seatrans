import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  APPLY_CONFIRMATION,
  MIGRATION_ID,
  PARTNER_PAIRS,
  RESOLVED_VALUES,
  SIMULATE_CONFIRMATION,
  checksumTargets,
  validatePairConfiguration,
} from './lib/booking-partner-dedupe.mjs';

const projectRoot = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const sqlPath = join(
  projectRoot,
  'scripts/migrations/2026-08-20_booking_partner_dedupe.sql',
);
const lockName = 'seatrans:booking-partner-dedupe:2026-08-20';

const dbFieldMap = {
  name: 'name',
  country: 'country',
  city: 'city',
  phone: 'phone',
  fax: 'fax',
  trackingUrl: 'tracking_url',
  address: 'address',
  customerStatus: 'customer_status',
  customerType: 'customer_type',
  taxNumber: 'tax_number',
  approveStatus: 'approve_status',
  approveBy: 'approve_by',
  companyEstablishmentDate: 'company_establishment_date',
  paymentDueDays: 'payment_due_days',
  contractNo: 'contract_no',
  invoiceCompanyName: 'invoice_company_name',
  invoiceCompanyAddress: 'invoice_company_address',
  invoiceCompanyPhone: 'invoice_company_phone',
  invoiceCompanyEmail: 'invoice_company_email',
  invoiceBankName: 'invoice_bank_name',
  invoiceBankBranch: 'invoice_bank_branch',
  invoiceBankAccount: 'invoice_bank_account',
  lockedAt: 'locked_at',
};
const mergeFields = Object.values(dbFieldMap);

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function buildClientConfig() {
  const sslEnabled = [
    'true',
    '1',
    'require',
    'verify-ca',
    'verify-full',
  ].includes(process.env.DB_SSL?.trim().toLowerCase() ?? '');
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'seatrans',
    ssl: sslEnabled
      ? {
          rejectUnauthorized:
            process.env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() ===
            'true',
        }
      : undefined,
    connectionTimeoutMillis: 15_000,
  };
}

export function parseArgs(argv) {
  const args = {
    apply: false,
    simulate: false,
    targetDb: null,
    confirm: null,
    backupOutput: null,
  };
  for (const argument of argv) {
    if (argument === '--apply') args.apply = true;
    else if (argument === '--simulate') args.simulate = true;
    else if (argument === '--dry-run') continue;
    else {
      const [key, ...rest] = argument.split('=');
      const value = rest.join('=');
      if (key === '--target-db') args.targetDb = value;
      else if (key === '--confirm') args.confirm = value;
      else if (key === '--backup-output') args.backupOutput = value;
      else throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return args;
}

export function assertApplyGuards(args, config) {
  if (!args.apply && !args.simulate) return;
  if (args.targetDb !== config.database) {
    throw new Error('--target-db must exactly match the configured database');
  }
  if (args.simulate) {
    if (args.apply)
      throw new Error('--apply and --simulate are mutually exclusive');
    if (args.confirm !== SIMULATE_CONFIRMATION) {
      throw new Error(`--confirm must equal ${SIMULATE_CONFIRMATION}`);
    }
    return;
  }
  if (args.confirm !== APPLY_CONFIRMATION) {
    throw new Error(`--confirm must equal ${APPLY_CONFIRMATION}`);
  }
  if (!args.backupOutput || !isAbsolute(args.backupOutput)) {
    throw new Error('--backup-output must be an absolute path');
  }
  if (existsSync(args.backupOutput)) {
    throw new Error('--backup-output must not already exist');
  }
  if (
    resolve(args.backupOutput)
      .toLowerCase()
      .startsWith(projectRoot.toLowerCase())
  ) {
    throw new Error('--backup-output must be outside backend2.0');
  }
}

const isBlank = (value) =>
  value == null || (typeof value === 'string' && value.trim() === '');

async function documentUsage(client, duplicateIds) {
  const ids = duplicateIds.map(String);
  const result = await client.query(
    `SELECT
      (SELECT count(*)::int FROM booking_records
        WHERE deleted_at IS NULL AND payload->>'clientPartyId' = ANY($1::text[])) AS booking_client,
      (SELECT count(*)::int FROM bill_of_lading_records
        WHERE deleted_at IS NULL AND (
          payload->>'shipperPartyId' = ANY($1::text[]) OR
          payload->>'consigneePartyId' = ANY($1::text[]) OR
          payload->>'notifyPartyId' = ANY($1::text[])
        )) AS bill_parties,
      (SELECT count(*)::int FROM arrival_notice_records
        WHERE deleted_at IS NULL AND (
          payload->>'agentPartyId' = ANY($1::text[]) OR
          payload->>'shipperPartyId' = ANY($1::text[]) OR
          payload->>'consigneePartyId' = ANY($1::text[]) OR
          payload->>'notifyPartyId' = ANY($1::text[])
        )) AS arrival_parties,
      (SELECT count(*)::int FROM delivery_order_records
        WHERE deleted_at IS NULL AND (
          payload->>'consigneePartyId' = ANY($1::text[]) OR
          payload->>'notifyPartyId' = ANY($1::text[])
        )) AS delivery_parties`,
    [ids],
  );
  const counts = result.rows[0];
  return {
    ...counts,
    total: Object.values(counts).reduce((sum, count) => sum + Number(count), 0),
  };
}

async function loadTargets(client, { lockRows = false } = {}) {
  const { allIds } = validatePairConfiguration();
  const partners = await client.query(
    `SELECT to_jsonb(partner) AS row
       FROM booking_partners AS partner
      WHERE id = ANY($1::int[])
      ORDER BY id
      ${lockRows ? 'FOR UPDATE OF partner' : ''}`,
    [allIds],
  );
  const additionTypes = await client.query(
    `SELECT partner_id, addition_type::text
       FROM booking_partner_addition_types
      WHERE partner_id = ANY($1::int[])
      ORDER BY partner_id, addition_type::text
      ${lockRows ? 'FOR UPDATE' : ''}`,
    [allIds],
  );
  return {
    partners: partners.rows.map(({ row }) => row),
    additionTypes: additionTypes.rows,
  };
}

function validateTargets(targets) {
  const { allIds } = validatePairConfiguration();
  if (targets.partners.length !== allIds.length) {
    throw new Error(`Expected ${allIds.length} active target partners`);
  }
  const actualIds = targets.partners
    .map(({ id }) => Number(id))
    .sort((a, b) => a - b);
  const expectedIds = [...allIds].sort((a, b) => a - b);
  if (actualIds.join(',') !== expectedIds.join(',')) {
    throw new Error('Target partner IDs do not match the approved pairs');
  }
  if (targets.partners.some(({ deleted_at: deletedAt }) => deletedAt != null)) {
    throw new Error('All target partners must be active');
  }
  return {
    targetPartners: targets.partners.length,
    targetTypeRows: targets.additionTypes.length,
  };
}

function expectedTypesByKeeper(targets) {
  const byPartner = new Map();
  for (const row of targets.additionTypes) {
    byPartner.set(row.partner_id, [
      ...(byPartner.get(row.partner_id) ?? []),
      row.addition_type,
    ]);
  }
  return Object.fromEntries(
    PARTNER_PAIRS.map(({ keepId, duplicateId }) => [
      keepId,
      [
        ...new Set([
          ...(byPartner.get(keepId) ?? []),
          ...(byPartner.get(duplicateId) ?? []),
        ]),
      ].sort(),
    ]),
  );
}

async function verifyPostflight(client, beforeTargets) {
  const { keepIds, duplicateIds } = validatePairConfiguration();
  const result = await client.query(
    `SELECT to_jsonb(partner) AS row
       FROM booking_partners AS partner
      WHERE id = ANY($1::int[])
      ORDER BY id`,
    [[...keepIds, ...duplicateIds]],
  );
  const rows = result.rows.map(({ row }) => row);
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  if (duplicateIds.some((id) => byId.has(id))) {
    throw new Error('One or more duplicate partners still exist');
  }
  if (keepIds.some((id) => !byId.has(id))) {
    throw new Error('One or more keeper partners are missing');
  }

  const beforeById = new Map(
    beforeTargets.partners.map((row) => [Number(row.id), row]),
  );
  for (const { keepId, duplicateId } of PARTNER_PAIRS) {
    const beforeKeep = beforeById.get(keepId);
    const beforeDuplicate = beforeById.get(duplicateId);
    const after = byId.get(keepId);
    for (const field of mergeFields) {
      if (isBlank(beforeKeep[field]) && !isBlank(beforeDuplicate[field])) {
        const resolvedKey = Object.entries(dbFieldMap).find(
          ([, dbField]) => dbField === field,
        )?.[0];
        if (
          !(resolvedKey in (RESOLVED_VALUES[keepId] ?? {})) &&
          after[field] !== beforeDuplicate[field]
        ) {
          throw new Error(`Keeper ${keepId} did not inherit ${field}`);
        }
      }
    }
    for (const [resolvedKey, expected] of Object.entries(
      RESOLVED_VALUES[keepId],
    )) {
      const dbField = dbFieldMap[resolvedKey];
      if (!dbField || after[dbField] !== expected) {
        throw new Error(`Keeper ${keepId} resolution mismatch: ${resolvedKey}`);
      }
    }
  }

  const typeRows = await client.query(
    `SELECT partner_id, addition_type::text
       FROM booking_partner_addition_types
      WHERE partner_id = ANY($1::int[])
      ORDER BY partner_id, addition_type::text`,
    [keepIds],
  );
  const actualTypes = new Map();
  for (const row of typeRows.rows) {
    actualTypes.set(row.partner_id, [
      ...(actualTypes.get(row.partner_id) ?? []),
      row.addition_type,
    ]);
  }
  const expectedTypes = expectedTypesByKeeper(beforeTargets);
  for (const keepId of keepIds) {
    if (
      (actualTypes.get(keepId) ?? []).join(',') !==
      expectedTypes[keepId].join(',')
    ) {
      throw new Error(`Keeper ${keepId} addition types mismatch`);
    }
  }
  return {
    keepers: keepIds.length,
    deletedDuplicates: duplicateIds.length,
    typeRows: typeRows.rows.length,
  };
}

async function getLedger(client) {
  const result = await client.query(
    `SELECT migration_id, script_checksum, status, backup_reference, details
       FROM app_schema_migrations
      WHERE migration_id = $1`,
    [MIGRATION_ID],
  );
  return result.rows[0] ?? null;
}

async function main() {
  loadEnvFile(join(projectRoot, '.env'));
  loadEnvFile(join(projectRoot, '.env.local'));
  const args = parseArgs(process.argv.slice(2));
  const config = buildClientConfig();
  assertApplyGuards(args, config);
  const sql = readFileSync(sqlPath, 'utf8');
  const sqlChecksum = createHash('sha256').update(sql).digest('hex');
  const { duplicateIds } = validatePairConfiguration();
  const client = new pg.Client(config);
  await client.connect();
  let lockAcquired = false;
  try {
    const ledger = await getLedger(client);
    if (ledger?.status === 'SUCCEEDED') {
      if (ledger.script_checksum !== sqlChecksum) {
        throw new Error('Applied migration SQL checksum does not match');
      }
      if (!ledger.backup_reference || !existsSync(ledger.backup_reference)) {
        throw new Error('Applied migration backup is missing');
      }
      const backup = JSON.parse(readFileSync(ledger.backup_reference, 'utf8'));
      if (
        backup.sqlChecksum !== sqlChecksum ||
        backup.targetChecksum !== checksumTargets(backup.targets)
      ) {
        throw new Error('Applied migration backup checksum is invalid');
      }
      const verified = await verifyPostflight(client, backup.targets);
      const usage = await documentUsage(client, duplicateIds);
      if (usage.total !== 0) {
        throw new Error(
          'Deleted duplicate IDs are still referenced by documents',
        );
      }
      console.log(
        JSON.stringify({
          mode: args.apply ? 'apply' : 'dry-run',
          alreadyApplied: true,
          database: config.database,
          sqlChecksum,
          backup: ledger.backup_reference,
          verified,
          usage,
          details: ledger.details,
        }),
      );
      return;
    }

    if (args.simulate) {
      const lock = await client.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
        [lockName],
      );
      lockAcquired = lock.rows[0]?.acquired === true;
      if (!lockAcquired)
        throw new Error('Partner dedupe migration is already running');
      await client.query("SET lock_timeout = '5s'");
      await client.query("SET statement_timeout = '120s'");
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      try {
        const targets = await loadTargets(client, { lockRows: true });
        const validation = validateTargets(targets);
        const usage = await documentUsage(client, duplicateIds);
        if (usage.total !== 0)
          throw new Error('Duplicate partners are referenced by documents');
        const targetChecksum = checksumTargets(targets);
        await client.query(sql);
        const verified = await verifyPostflight(client, targets);
        await client.query('ROLLBACK');
        console.log(
          JSON.stringify({
            mode: 'simulation',
            rolledBack: true,
            database: config.database,
            sqlChecksum,
            targetChecksum,
            validation,
            usage,
            verified,
          }),
        );
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      return;
    }

    if (!args.apply) {
      await client.query(
        'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      );
      try {
        const targets = await loadTargets(client);
        const validation = validateTargets(targets);
        const usage = await documentUsage(client, duplicateIds);
        if (usage.total !== 0)
          throw new Error('Duplicate partners are referenced by documents');
        const targetChecksum = checksumTargets(targets);
        await client.query('ROLLBACK');
        console.log(
          JSON.stringify({
            mode: 'dry-run',
            readOnly: true,
            database: config.database,
            sqlChecksum,
            targetChecksum,
            validation,
            usage,
          }),
        );
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      return;
    }

    const lock = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [lockName],
    );
    lockAcquired = lock.rows[0]?.acquired === true;
    if (!lockAcquired)
      throw new Error('Partner dedupe migration is already running');
    await client.query("SET lock_timeout = '5s'");
    await client.query("SET statement_timeout = '120s'");

    const beforeTargets = await loadTargets(client);
    const validation = validateTargets(beforeTargets);
    const usage = await documentUsage(client, duplicateIds);
    if (usage.total !== 0)
      throw new Error('Duplicate partners are referenced by documents');
    const targetChecksum = checksumTargets(beforeTargets);
    const backup = {
      format: 'seatrans-booking-partner-dedupe-backup-v1',
      migrationId: MIGRATION_ID,
      createdAt: new Date().toISOString(),
      database: config.database,
      sqlChecksum,
      targetChecksum,
      pairs: PARTNER_PAIRS,
      targets: beforeTargets,
      usage,
    };
    const backupText = `${JSON.stringify(backup, null, 2)}\n`;
    writeFileSync(args.backupOutput, backupText, {
      encoding: 'utf8',
      flag: 'wx',
    });
    const backupChecksum = createHash('sha256')
      .update(backupText)
      .digest('hex');

    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
      const lockedTargets = await loadTargets(client, { lockRows: true });
      if (checksumTargets(lockedTargets) !== targetChecksum) {
        throw new Error('Target partners changed after backup');
      }
      const lockedUsage = await documentUsage(client, duplicateIds);
      if (lockedUsage.total !== 0)
        throw new Error('Duplicate partners gained document references');
      await client.query(
        `INSERT INTO app_schema_migrations
          (migration_id, script_checksum, status, backup_reference,
           logical_export_reference, details, started_at, completed_at)
         VALUES ($1, $2, 'RUNNING', $3, $3, $4::jsonb, NOW(), NULL)`,
        [
          MIGRATION_ID,
          sqlChecksum,
          args.backupOutput,
          JSON.stringify({ targetChecksum, backupChecksum, validation, usage }),
        ],
      );
      await client.query(sql);
      const verified = await verifyPostflight(client, lockedTargets);
      await client.query(
        `UPDATE app_schema_migrations
            SET status = 'SUCCEEDED', completed_at = NOW(),
                details = details || $2::jsonb
          WHERE migration_id = $1`,
        [MIGRATION_ID, JSON.stringify({ verified })],
      );
      await client.query('COMMIT');
      console.log(
        JSON.stringify({
          committed: true,
          database: config.database,
          sqlChecksum,
          targetChecksum,
          backup: args.backupOutput,
          backupChecksum,
          verified,
        }),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    if (lockAcquired)
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]);
    await client.end();
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
