import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const PHASES = {
  expand: '2026-08-21_booking_documents_relational_expand.sql',
  data: '2026-08-21_booking_documents_relational_data.sql',
  validate: '2026-08-21_booking_documents_relational_validate.sql',
  report: '2026-08-21_booking_reporting_v1.sql',
};
const TOKENS = {
  expand: 'APPLY_BOOKING_RELATIONAL_EXPAND_20260821',
  data: 'APPLY_BOOKING_RELATIONAL_DATA_20260821',
  validate: 'APPLY_BOOKING_RELATIONAL_VALIDATE_20260821',
  report: 'APPLY_BOOKING_REPORT_VIEW_20260821',
};

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    const separator = value.indexOf('=');
    if (separator < 1) continue;
    const key = value.slice(0, separator).trim();
    let content = value.slice(separator + 1).trim();
    if (
      (content.startsWith('"') && content.endsWith('"')) ||
      (content.startsWith("'") && content.endsWith("'"))
    )
      content = content.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = content;
  }
}

export function parseArgs(argv) {
  const args = {
    apply: false,
    phase: 'expand',
    targetDb: null,
    confirmation: null,
    pgDump: null,
  };
  for (const item of argv) {
    if (item === '--apply') args.apply = true;
    else if (item === '--dry-run' || item === '--preflight') args.apply = false;
    else {
      const [key, ...rest] = item.split('=');
      const value = rest.join('=');
      if (key === '--phase' && Object.hasOwn(PHASES, value)) args.phase = value;
      else if (key === '--target-db') args.targetDb = value;
      else if (key === '--confirm') args.confirmation = value;
      else if (key === '--pg-dump') args.pgDump = value;
      else throw new Error(`Unknown argument: ${item}`);
    }
  }
  return args;
}

function config() {
  const url = process.env.DB_URL?.trim();
  const ssl = ['true', '1', 'require', 'verify-ca', 'verify-full'].includes(
    process.env.DB_SSL?.toLowerCase() ?? '',
  )
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' }
    : undefined;
  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 5432,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\/+/, ''),
      ssl,
    };
  }
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'seatrans',
    ssl,
  };
}

export function assertApplyGuards(args, database) {
  if (!args.apply) return;
  if (args.targetDb !== database)
    throw new Error('--target-db must exactly match configured database');
  if (args.confirmation !== TOKENS[args.phase])
    throw new Error(`--confirm must equal ${TOKENS[args.phase]}`);
  if (
    !args.pgDump ||
    !isAbsolute(args.pgDump) ||
    !existsSync(args.pgDump) ||
    statSync(args.pgDump).size === 0
  )
    throw new Error(
      '--pg-dump must be an existing, non-empty absolute pg_dump file',
    );
}

async function inspect(client) {
  const result = await client.query(`
    SELECT current_database() AS database,
      (SELECT COUNT(*)::int FROM public.booking_records) AS bookings,
      (SELECT COUNT(*)::int FROM public.bill_of_lading_records) AS bills,
      (SELECT COUNT(*)::int FROM public.arrival_notice_records) AS notices,
      (SELECT COUNT(*)::int FROM public.delivery_order_records) AS delivery_orders,
      to_regclass('public.booking_cargo_volumes')::text AS cargo_table,
      to_regclass('public.booking_reporting_v1')::text AS report_view
  `);
  const schemaState = result.rows[0];
  const ports = (
    await client.query(`SELECT id,name,code,port_of_call,
    to_jsonb(ports)->>'sub_name_1' sub_name_1,
    to_jsonb(ports)->>'sub_name_2' sub_name_2 FROM public.ports`)
  ).rows;
  const snapshots = (
    await client.query(`
    SELECT 'booking' source,record.id,field.key,field.value,record.payload->>(CASE WHEN field.key='transitPort' THEN 'transitPortId' ELSE field.key||'PortId' END) explicit_id FROM public.booking_records record CROSS JOIN LATERAL jsonb_each_text(record.payload) field WHERE field.key=ANY(ARRAY['placeOfReceipt','portOfLoading','placeOfIssue','pickupPlace','portOfDischarge','placeOfDelivery','dropoffPlace','transitPort']) AND BTRIM(field.value)<>''
    UNION ALL SELECT 'an',record.id,field.key,field.value,record.payload->>(field.key||'PortId') explicit_id FROM public.arrival_notice_records record CROSS JOIN LATERAL jsonb_each_text(record.payload) field WHERE field.key=ANY(ARRAY['placeOfReceipt','portOfLoading','portOfDischarge','placeOfDelivery','finalDestination']) AND BTRIM(field.value)<>''
    UNION ALL SELECT 'do',record.id,field.key,field.value,record.payload->>(field.key||'PortId') explicit_id FROM public.delivery_order_records record CROSS JOIN LATERAL jsonb_each_text(record.payload) field WHERE field.key=ANY(ARRAY['placeOfReceipt','portOfLoading','portOfDischarge','placeOfDelivery','finalDestination']) AND BTRIM(field.value)<>''
    UNION ALL SELECT 'bl',record.id,field.key,field.value,record.payload->>(field.key||'PortId') explicit_id FROM public.bill_of_lading_records record CROSS JOIN LATERAL jsonb_each_text(record.payload) field WHERE field.key=ANY(ARRAY['placeOfReceipt','portOfLoading','portOfDischarge','placeOfDelivery','placeOfIssue']) AND BTRIM(field.value)<>''
  `)
  ).rows;
  const normalize = (value) =>
    String(value ?? '')
      .trim()
      .toUpperCase();
  const exactPorts = new Map();
  const codePorts = new Map();
  const validPortIds = new Set(ports.map((port) => Number(port.id)));
  const addPort = (map, key, id) => {
    if (!key) return;
    const ids = map.get(key) ?? new Set();
    ids.add(Number(id));
    map.set(key, ids);
  };
  for (const port of ports) {
    for (const name of [
      port.name,
      port.sub_name_1,
      port.sub_name_2,
      port.port_of_call,
    ])
      addPort(exactPorts, normalize(name), port.id);
    addPort(codePorts, normalize(port.code), port.id);
  }
  const unresolvedPortRows = snapshots.flatMap((snapshot) => {
    const explicitId = Number(snapshot.explicit_id);
    if (Number.isSafeInteger(explicitId) && validPortIds.has(explicitId))
      return [];
    const value = normalize(snapshot.value);
    const matches = new Set(exactPorts.get(value) ?? []);
    for (const token of value.match(/[A-Z]{2}[A-Z0-9]{3}/g) ?? [])
      for (const portId of codePorts.get(token) ?? []) matches.add(portId);
    return matches.size === 1
      ? []
      : [
          {
            source: snapshot.source,
            id: snapshot.id,
            field: snapshot.key,
            value: snapshot.value,
            matches: matches.size,
          },
        ];
  });
  const unresolvedPackages = await client.query(`
    WITH rows AS (
      SELECT item.row->>'packageType' value FROM public.bill_of_lading_records record CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(record.payload->'containers')='array' THEN record.payload->'containers' ELSE '[]'::jsonb END) item(row)
      UNION ALL SELECT item.row->>'packageType' FROM public.arrival_notice_records record CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(record.payload->'containers')='array' THEN record.payload->'containers' ELSE '[]'::jsonb END) item(row)
      UNION ALL SELECT item.row->>'packageType' FROM public.delivery_order_records record CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(record.payload->'containers')='array' THEN record.payload->'containers' ELSE '[]'::jsonb END) item(row)
    ) SELECT COUNT(*)::int unresolved_count FROM rows WHERE NULLIF(BTRIM(value),'') IS NOT NULL AND
      (SELECT COUNT(*) FROM public.commodity_types type JOIN public.service_types service ON service.id=type.service_type_id AND UPPER(BTRIM(service.name))='FREIGHT FORWARDING' WHERE LOWER(REGEXP_REPLACE(BTRIM(type.name),'\\s+',' ','g'))=LOWER(REGEXP_REPLACE(BTRIM(rows.value),'\\s+',' ','g')))<>1
  `);
  let relationalControls = null;
  if (schemaState.cargo_table) {
    relationalControls = (
      await client.query(`
        WITH legacy_cargo AS (
          SELECT COALESCE(SUM((volume.value #>> '{}')::integer), 0)::int AS quantity
            FROM public.booking_records record
           CROSS JOIN LATERAL jsonb_each(
             CASE WHEN jsonb_typeof(record.payload->'cargoVolumes')='object'
                  THEN record.payload->'cargoVolumes' ELSE '{}'::jsonb END
           ) volume
           WHERE BTRIM(volume.key) <> ''
             AND volume.value #>> '{}' ~ '^\\d+$'
             AND (volume.value #>> '{}')::integer > 0
        ),
        legacy_bill_containers AS (
          SELECT COUNT(*)::int AS row_count
            FROM public.bill_of_lading_records record
           CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(record.payload->'containers')='array'
                  THEN record.payload->'containers' ELSE '[]'::jsonb END
           ) item(row)
           WHERE EXISTS (
             SELECT 1 FROM jsonb_each_text(item.row) field
              WHERE BTRIM(field.value) <> ''
           )
        )
        SELECT
          (SELECT COUNT(*)::int FROM public.booking_cargo_volumes) AS cargo_rows,
          (SELECT COALESCE(SUM(quantity), 0)::int FROM public.booking_cargo_volumes) AS planned_quantity,
          (SELECT quantity FROM legacy_cargo) AS legacy_planned_quantity,
          (SELECT COUNT(*)::int FROM public.bill_of_lading_containers) AS bill_container_rows,
          (SELECT row_count FROM legacy_bill_containers) AS legacy_bill_container_rows,
          (SELECT COUNT(*)::int FROM public.arrival_notice_containers) AS notice_container_rows,
          (SELECT COUNT(*)::int FROM public.delivery_order_containers) AS delivery_container_rows,
          (SELECT COUNT(*)::int FROM public.booking_records WHERE payload IS NULL) AS missing_booking_payloads,
          (SELECT COUNT(*)::int FROM public.bill_of_lading_records WHERE payload IS NULL) AS missing_bill_payloads,
          (SELECT COUNT(*)::int FROM public.booking_records
            WHERE document_number_v2 IS DISTINCT FROM NULLIF(BTRIM(payload->>'bookingNumber'), '')) AS booking_number_mismatches,
          (SELECT COUNT(*)::int FROM public.bill_of_lading_records
            WHERE document_number_v2 IS DISTINCT FROM NULLIF(BTRIM(payload->>'fblNumber'), '')) AS bill_number_mismatches,
          (SELECT COUNT(*)::int FROM public.bill_of_lading_containers container
            WHERE COALESCE(NULLIF(BTRIM(container.container_type_code), ''),
                           NULLIF(BTRIM(container.container_no), ''),
                           NULLIF(BTRIM(container.seal_no), ''),
                           NULLIF(BTRIM(container.gross_weight_raw), ''),
                           NULLIF(BTRIM(container.measurement_raw), ''),
                           NULLIF(BTRIM(container.tare_raw), ''),
                           NULLIF(BTRIM(container.package_type_snapshot), ''),
                           NULLIF(BTRIM(container.number_of_packages_raw), ''),
                           NULLIF(BTRIM(container.method), ''),
                           NULLIF(BTRIM(container.presentation_payload->>'note'), '')) IS NULL
          ) AS blank_bill_containers,
          (SELECT COUNT(*)::int
             FROM pg_constraint constraint_record
            WHERE NOT constraint_record.convalidated
              AND (
                constraint_record.conname LIKE 'fk_booking_records_%' OR
                constraint_record.conname LIKE 'fk_bl_records_%' OR
                constraint_record.conname LIKE 'fk_an_records_%' OR
                constraint_record.conname LIKE 'fk_do_records_%' OR
                constraint_record.conname IN (
                  'ck_bl_containers_not_blank',
                  'ck_an_containers_not_blank',
                  'ck_do_containers_not_blank'
                )
              )
          ) AS unvalidated_constraints
      `)
    ).rows[0];
  }
  let reportControls = null;
  if (schemaState.report_view) {
    reportControls = (
      await client.query(`
        SELECT COUNT(*)::int AS report_rows,
               COUNT(DISTINCT booking_id)::int AS distinct_report_bookings,
               (COUNT(*) - COUNT(DISTINCT booking_id))::int AS duplicate_report_rows
          FROM public.booking_reporting_v1
      `)
    ).rows[0];
  }
  return {
    ...schemaState,
    unresolvedPorts: {
      unresolved_count: unresolvedPortRows.length,
      sample: unresolvedPortRows.slice(0, 20),
    },
    unresolvedPackageTypes: unresolvedPackages.rows[0],
    relationalControls,
    reportControls,
  };
}

async function main() {
  loadEnv(join(ROOT, '.env'));
  loadEnv(join(ROOT, '.env.local'));
  const args = parseArgs(process.argv.slice(2));
  const db = config();
  assertApplyGuards(args, db.database);
  const sql = readFileSync(
    join(ROOT, 'scripts', 'migrations', PHASES[args.phase]),
    'utf8',
  );
  const checksum = createHash('sha256').update(sql).digest('hex');
  const client = new pg.Client(db);
  await client.connect();
  let locked = false;
  try {
    const before = await inspect(client);
    console.log(
      JSON.stringify(
        {
          mode: args.apply ? 'apply' : 'dry-run',
          phase: args.phase,
          targetDatabase: before.database,
          checksum,
          preflight: before,
        },
        null,
        2,
      ),
    );
    if (!args.apply) {
      console.log('READ ONLY preflight; no writes occurred.');
      return;
    }
    const lockName = `seatrans:booking-relational:${args.phase}:2026-08-21`;
    locked =
      (
        await client.query(
          'SELECT pg_try_advisory_lock(hashtext($1)) acquired',
          [lockName],
        )
      ).rows[0]?.acquired === true;
    if (!locked)
      throw new Error('Another booking relational migration is running');
    await client.query("SET lock_timeout='5s'");
    await client.query("SET statement_timeout='10min'");
    const statements = sql
      .split(/\r?\n-- statement-break\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (args.phase === 'expand') {
      await client.query('BEGIN');
      try {
        await client.query(statements[0]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      for (const statement of statements.slice(1))
        await client.query(statement);
    } else {
      await client.query('BEGIN');
      try {
        for (const [index, statement] of statements.entries()) {
          console.log(`Applying ${args.phase} step ${index + 1}/${statements.length}`);
          await client.query(statement);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    const after = await inspect(client);
    console.log(
      JSON.stringify(
        {
          applied: true,
          phase: args.phase,
          postflight: after,
          pgDumpSha256: createHash('sha256')
            .update(readFileSync(args.pgDump))
            .digest('hex'),
        },
        null,
        2,
      ),
    );
  } finally {
    if (locked)
      await client
        .query('SELECT pg_advisory_unlock(hashtext($1))', [
          `seatrans:booking-relational:${args.phase}:2026-08-21`,
        ])
        .catch(() => undefined);
    await client.end();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
