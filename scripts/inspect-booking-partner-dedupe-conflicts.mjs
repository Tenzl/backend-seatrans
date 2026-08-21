import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const PAIRS = [
  { keepId: 111, duplicateId: 39 },
  { keepId: 48, duplicateId: 122 },
  { keepId: 2, duplicateId: 11 },
  { keepId: 19, duplicateId: 37 },
  { keepId: 30, duplicateId: 90 },
  { keepId: 75, duplicateId: 31 },
  { keepId: 32, duplicateId: 94 },
  { keepId: 13, duplicateId: 28 },
  { keepId: 23, duplicateId: 92 },
  { keepId: 35, duplicateId: 95 },
  { keepId: 33, duplicateId: 83 },
  { keepId: 42, duplicateId: 50 },
  { keepId: 109, duplicateId: 97 },
  { keepId: 65, duplicateId: 64 },
  { keepId: 41, duplicateId: 43 },
  { keepId: 108, duplicateId: 80 },
  { keepId: 69, duplicateId: 68 },
  { keepId: 26, duplicateId: 25 },
];

const BUSINESS_FIELDS = [
  'name',
  'country',
  'city',
  'phone',
  'fax',
  'tracking_url',
  'address',
  'customer_status',
  'customer_type',
  'tax_number',
  'approve_status',
  'approve_by',
  'company_establishment_date',
  'payment_due_days',
  'contract_no',
  'invoice_company_name',
  'invoice_company_address',
  'invoice_company_phone',
  'invoice_company_email',
  'invoice_bank_name',
  'invoice_bank_branch',
  'invoice_bank_account',
  'locked_at',
];

const normalizeBlank = (value) => {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return value;
};

const comparable = (value) =>
  typeof value === 'string' ? value.trim().toLocaleUpperCase('en-US') : value;

const classifyField = (keepValue, duplicateValue) => {
  const keep = normalizeBlank(keepValue);
  const duplicate = normalizeBlank(duplicateValue);
  if (keep == null && duplicate == null) return 'EMPTY';
  if (keep == null) return 'COPY_FROM_DUPLICATE';
  if (duplicate == null) return 'KEEP_EXISTING';
  if (comparable(keep) === comparable(duplicate)) return 'SAME';
  return 'CONFLICT';
};

const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl:
    String(process.env.DB_SSL).toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
  connectionTimeoutMillis: 15_000,
});

async function main() {
  const ids = PAIRS.flatMap(({ keepId, duplicateId }) => [keepId, duplicateId]);
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const partnersResult = await client.query(
      `SELECT *
       FROM booking_partners
       WHERE id = ANY($1::int[])
       ORDER BY id`,
      [ids],
    );
    const typesResult = await client.query(
      `SELECT partner_id, addition_type::text
       FROM booking_partner_addition_types
       WHERE partner_id = ANY($1::int[])
       ORDER BY partner_id, addition_type::text`,
      [ids],
    );
    const typesByPartner = new Map();
    for (const row of typesResult.rows) {
      const current = typesByPartner.get(row.partner_id) ?? [];
      current.push(row.addition_type);
      typesByPartner.set(row.partner_id, current);
    }
    const partnersById = new Map(
      partnersResult.rows.map((row) => [Number(row.id), row]),
    );

    const pairs = PAIRS.map(({ keepId, duplicateId }) => {
      const keep = partnersById.get(keepId);
      const duplicate = partnersById.get(duplicateId);
      if (!keep || !duplicate) {
        return { keepId, duplicateId, blocker: 'PARTNER_NOT_FOUND' };
      }
      const fields = BUSINESS_FIELDS.map((field) => ({
        field,
        action: classifyField(keep[field], duplicate[field]),
        keepValue: normalizeBlank(keep[field]),
        duplicateValue: normalizeBlank(duplicate[field]),
      }));
      const keepTypes = typesByPartner.get(keepId) ?? [];
      const duplicateTypes = typesByPartner.get(duplicateId) ?? [];
      const mergedTypes = [
        ...new Set([...keepTypes, ...duplicateTypes]),
      ].sort();
      const keepContacts = Array.isArray(keep.contacts) ? keep.contacts : [];
      const duplicateContacts = Array.isArray(duplicate.contacts)
        ? duplicate.contacts
        : [];
      return {
        keep: {
          id: keepId,
          customerId: keep.customer_id,
          name: keep.name,
          deletedAt: keep.deleted_at,
        },
        duplicate: {
          id: duplicateId,
          customerId: duplicate.customer_id,
          name: duplicate.name,
          deletedAt: duplicate.deleted_at,
        },
        conflicts: fields.filter(({ action }) => action === 'CONFLICT'),
        copyFromDuplicate: fields.filter(
          ({ action }) => action === 'COPY_FROM_DUPLICATE',
        ),
        same: fields.filter(({ action }) => action === 'SAME'),
        additionTypes: { keepTypes, duplicateTypes, mergedTypes },
        contacts: { keepContacts, duplicateContacts },
      };
    });

    console.log(
      JSON.stringify(
        {
          database: process.env.DB_DATABASE,
          mode: 'READ_ONLY',
          pairCount: pairs.length,
          conflictCount: pairs.reduce(
            (sum, pair) => sum + (pair.conflicts?.length ?? 0),
            0,
          ),
          pairs,
        },
        null,
        2,
      ),
    );
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
