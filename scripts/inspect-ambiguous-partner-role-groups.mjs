import 'dotenv/config';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Client } = pg;

const normalize = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');

const classificationPath = process.argv
  .slice(2)
  .find((argument) => argument.startsWith('--classification='))
  ?.slice('--classification='.length);
if (!classificationPath) throw new Error('--classification is required');

const classification = JSON.parse(readFileSync(classificationPath, 'utf8'));
const roleDefinitions = [
  { issue: 'CLIENT_AMBIGUOUS', field: 'Client', role: 'CLIENT' },
  { issue: 'SHIPPER_AMBIGUOUS', field: 'Shipper', role: 'SHIPPER' },
  { issue: 'CONSIGNEE_AMBIGUOUS', field: 'Consignee', role: 'CONSIGNEE' },
];
const sources = new Map();
for (const definition of roleDefinitions) {
  for (const record of classification.records) {
    if (!record.issues.includes(definition.issue)) continue;
    const sourceName = String(record.raw?.[definition.field] ?? '').trim();
    const key = normalize(sourceName);
    const current = sources.get(key) ?? {
      normalizedKey: key,
      sourceNames: new Set(),
      roles: {},
      shipmentIds: new Set(),
    };
    current.sourceNames.add(sourceName);
    current.roles[definition.role] = (current.roles[definition.role] ?? 0) + 1;
    current.shipmentIds.add(record.raw?.['Shipment ID']);
    sources.set(key, current);
  }
}

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

await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  const partners = await client.query(`
    SELECT id, customer_id, name, country, city, address, tax_number,
           customer_status::text, customer_type::text, contacts, deleted_at
    FROM booking_partners
    WHERE deleted_at IS NULL
    ORDER BY id
  `);
  const additionTypes = await client.query(`
    SELECT partner_id, addition_type::text
    FROM booking_partner_addition_types
    ORDER BY partner_id, addition_type::text
  `);
  const documents = await client.query(`
    SELECT 'booking' AS kind, payload FROM booking_records WHERE deleted_at IS NULL
    UNION ALL
    SELECT 'bl', payload FROM bill_of_lading_records WHERE deleted_at IS NULL
    UNION ALL
    SELECT 'an', payload FROM arrival_notice_records WHERE deleted_at IS NULL
    UNION ALL
    SELECT 'do', payload FROM delivery_order_records WHERE deleted_at IS NULL
  `);
  const usageFor = (partnerId) => {
    const id = String(partnerId);
    const usage = {
      bookingClient: 0,
      blShipper: 0,
      blConsignee: 0,
      blNotify: 0,
      anAgent: 0,
      anShipper: 0,
      anConsignee: 0,
      anNotify: 0,
      doConsignee: 0,
      doNotify: 0,
    };
    for (const document of documents.rows) {
      const payload = document.payload ?? {};
      if (
        document.kind === 'booking' &&
        String(payload.clientPartyId ?? '') === id
      )
        usage.bookingClient += 1;
      if (document.kind === 'bl' && String(payload.shipperPartyId ?? '') === id)
        usage.blShipper += 1;
      if (
        document.kind === 'bl' &&
        String(payload.consigneePartyId ?? '') === id
      )
        usage.blConsignee += 1;
      if (document.kind === 'bl' && String(payload.notifyPartyId ?? '') === id)
        usage.blNotify += 1;
      if (document.kind === 'an' && String(payload.agentPartyId ?? '') === id)
        usage.anAgent += 1;
      if (document.kind === 'an' && String(payload.shipperPartyId ?? '') === id)
        usage.anShipper += 1;
      if (
        document.kind === 'an' &&
        String(payload.consigneePartyId ?? '') === id
      )
        usage.anConsignee += 1;
      if (document.kind === 'an' && String(payload.notifyPartyId ?? '') === id)
        usage.anNotify += 1;
      if (
        document.kind === 'do' &&
        String(payload.consigneePartyId ?? '') === id
      )
        usage.doConsignee += 1;
      if (document.kind === 'do' && String(payload.notifyPartyId ?? '') === id)
        usage.doNotify += 1;
    }
    return {
      ...usage,
      total: Object.values(usage).reduce((sum, count) => sum + count, 0),
    };
  };
  const typesByPartner = new Map();
  for (const row of additionTypes.rows) {
    typesByPartner.set(row.partner_id, [
      ...(typesByPartner.get(row.partner_id) ?? []),
      row.addition_type,
    ]);
  }
  const partnersByKey = new Map();
  for (const partner of partners.rows) {
    const key = normalize(partner.name);
    partnersByKey.set(key, [
      ...(partnersByKey.get(key) ?? []),
      {
        ...partner,
        additionTypes: typesByPartner.get(partner.id) ?? [],
        usage: usageFor(partner.id),
      },
    ]);
  }
  const groups = [...sources.values()]
    .map((source) => ({
      normalizedKey: source.normalizedKey,
      sourceNames: [...source.sourceNames].sort(),
      roles: source.roles,
      distinctShipmentCount: source.shipmentIds.size,
      matches: partnersByKey.get(source.normalizedKey) ?? [],
    }))
    .filter((group) => group.matches.length > 1)
    .sort((left, right) =>
      left.sourceNames[0].localeCompare(right.sourceNames[0]),
    );
  const allActiveDuplicateGroups = [...partnersByKey.entries()]
    .filter(([, matches]) => matches.length > 1)
    .map(([normalizedKey, matches]) => ({ normalizedKey, matches }))
    .sort((left, right) =>
      left.matches[0].name.localeCompare(right.matches[0].name),
    );
  console.log(
    JSON.stringify(
      {
        database: process.env.DB_DATABASE,
        readOnly: true,
        uniqueAmbiguousNames: groups.length,
        groups,
        allActiveDuplicateNameCount: allActiveDuplicateGroups.length,
        allActiveDuplicateGroups,
      },
      null,
      2,
    ),
  );
  await client.query('ROLLBACK');
} finally {
  await client.end();
}
