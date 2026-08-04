/**
 * Seed one Import + one Export Booking Confirmation (transport document forms)
 * into booking_document_records for UI / workflow testing.
 *
 * Usage:
 *   node scripts/seed-import-export-booking-forms.mjs
 *   node scripts/seed-import-export-booking-forms.mjs --with-children
 *   node scripts/seed-import-export-booking-forms.mjs --force
 *
 * Reads DB settings from backend2.0/.env (same pattern as other apply-*.mjs scripts).
 * Idempotent by reference_number unless --force is passed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

const root = resolve(import.meta.dirname, '..');

const SEED_TAG = 'SEED_IMPORT_EXPORT_FORMS_20260804';
const IMPORT_REF = 'SEED-IMP-BK-20260804';
const EXPORT_REF = 'SEED-EXP-BK-20260804';
const IMPORT_AN_REF = 'SEED-IMP-AN-20260804';
const IMPORT_DO_REF = 'SEED-IMP-DO-20260804';
const EXPORT_AN_REF = 'SEED-EXP-AN-20260804';
const EXPORT_BL_REF = 'SEED-EXP-BL-20260804';

function loadEnv(path) {
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
  const explicit = process.env.DB_SSL?.trim().toLowerCase();
  const ssl = ['true', '1', 'require', 'verify-ca', 'verify-full'].includes(
    explicit ?? '',
  )
    ? {
        rejectUnauthorized:
          process.env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() ===
          'true',
      }
    : undefined;

  const dbUrl = process.env.DB_URL?.trim();
  if (dbUrl) {
    const parsed = new URL(dbUrl);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 5432,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ''),
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

function parseArgs(argv) {
  return {
    withChildren: argv.includes('--with-children'),
    force: argv.includes('--force'),
  };
}

function importBookingPayload() {
  return {
    date: '04 Aug 2026',
    bookingNumber: IMPORT_REF,
    to: 'APEX LOGISTICS VIETNAM CO., LTD\n12 NGUYEN HUE, DISTRICT 1, HO CHI MINH CITY, VIETNAM\nTEL: +84-28-3822-1100',
    vesselVoyage: 'SITC OSAKA / 2628S',
    etd: '10 Aug 2026',
    eta: '18 Aug 2026',
    placeOfReceipt: 'YOKOHAMA, JP (JPYOK)',
    portOfLoading: 'YOKOHAMA, JP (JPYOK)',
    pickupDate: '08 Aug 2026',
    pickupPlace: 'YOKOHAMA CY',
    portOfDischarge: 'CAT LAI, HO CHI MINH, VN (VNSGN)',
    placeOfDelivery: 'CAT LAI, HO CHI MINH, VN (VNSGN)',
    dropoffPlace: 'CAT LAI TERMINAL',
    closingTime: '07 Aug 2026 17:00',
    siCutoff: '07 Aug 2026 12:00',
    vgmCutoff: '07 Aug 2026 15:00',
    contact: 'Ms. Linh / ops-import@apex-logistics.vn / +84-90-123-4567',
    commodity: 'ELECTRONIC COMPONENTS\nHS CODE: 8542.31\n1x40\'HC FCL',
    volume: '1x40\'HC',
    grossWeight: '12,450 KGS',
    measurement: '58.20 CBM',
    transitPort: 'HONG KONG, CN (HKHKG)',
    specialRemark:
      'SEED IMPORT sample for UI testing.\nFree time: 5 days demurrage at destination.\nNotify consignee 48h before ETA.',
    motherVessel: 'SITC OSAKA',
    motherVoyage: '2628S',
    pic: 'Import desk — Seatrans HCMC\nEmail: import@seatrans.vn',
  };
}

function exportBookingPayload() {
  return {
    date: '04 Aug 2026',
    bookingNumber: EXPORT_REF,
    to: 'AN THINH STONE CO., LTD\n92 HAI BA TRUNG STREET, QUI NHON WARD, GIA LAI PROVINCE, VIETNAM\nTEL: +84-256-3701-745',
    vesselVoyage: 'SITC MINHE / 2615N',
    etd: '14 Aug 2026',
    eta: '22 Aug 2026',
    placeOfReceipt: 'QUI NHON, VN (VNUIH)',
    portOfLoading: 'DA NANG, VN (VNDAD)',
    pickupDate: '12 Aug 2026',
    pickupPlace: 'QUI NHON ICD',
    portOfDischarge: 'HAKATA, FUKUOKA, JP (JPHKT)',
    placeOfDelivery: 'HAKATA, FUKUOKA, JP (JPHKT)',
    dropoffPlace: 'HAKATA CY',
    closingTime: '11 Aug 2026 16:00',
    siCutoff: '11 Aug 2026 10:00',
    vgmCutoff: '11 Aug 2026 14:00',
    contact: 'Mr. Hung / export@anthinhstone.vn / +84-256-3701-745',
    commodity:
      'GRANITE STONES, BASALT STONES\nHS CODE: 6801.00\n1x20\'DC FCL / CY-CY',
    volume: '1x20\'DC',
    grossWeight: '20,700 KGS',
    measurement: '7.26 CBM',
    transitPort: 'BUSAN, KR (KRPUS)',
    specialRemark:
      'SEED EXPORT sample for UI testing.\nShipper load / count / seal.\nFreight collect at destination.',
    motherVessel: 'SITC MINHE',
    motherVoyage: '2615N',
    pic: 'Export desk — Seatrans Da Nang\nEmail: export@seatrans.vn',
  };
}

function importArrivalNoticePayload() {
  return {
    agent: 'SEATRANS SHIPPING AGENCY',
    date: '04 Aug 2026',
    anNumber: IMPORT_AN_REF,
    shipper:
      'TOKYO ELECTRONICS TRADING CO., LTD\n3-1-1 MINATO, YOKOHAMA, JAPAN',
    consignee:
      'APEX LOGISTICS VIETNAM CO., LTD\n12 NGUYEN HUE, DISTRICT 1, HO CHI MINH CITY, VIETNAM',
    notifyParty: 'SAME AS CONSIGNEE',
    mblNumber: 'SITC2628S001',
    hblNumber: IMPORT_AN_REF,
    vesselVoyage: 'SITC OSAKA / 2628S',
    etdEta: 'ETD 10 Aug 2026 / ETA 18 Aug 2026',
    cfsTerminal: 'CAT LAI CFS',
    shipmentNumber: 'IMP-SHP-260804',
    referenceNumber: IMPORT_REF,
    billOfLadingType: 'Surrendered',
    placeOfReceipt: 'YOKOHAMA, JP (JPYOK)',
    portOfLoading: 'YOKOHAMA, JP (JPYOK)',
    portOfDischarge: 'CAT LAI, HO CHI MINH, VN (VNSGN)',
    placeOfDelivery: 'CAT LAI, HO CHI MINH, VN (VNSGN)',
    finalDestination: 'HO CHI MINH CITY, VN',
    serviceMode: 'FCL / CY-CY',
    note: 'SEED IMPORT AN — for workflow testing.',
    marks: 'N/M\nSITU2631620 / 40\'HC',
    volume: '1x40\'HC',
    customerAttention: 'Please arrange customs clearance before free time ends.',
    cargoRows: [
      {
        containerSealNumber: 'SITU2631620 / SEAL998877',
        quantity: '1x40\'HC / 180 CTNS',
        descriptionOfGoods: 'ELECTRONIC COMPONENTS',
        grossWeight: '12,450 KGS',
        measurement: '58.20 CBM',
      },
    ],
  };
}

function importDeliveryOrderPayload() {
  return {
    doNumber: IMPORT_DO_REF,
    date: '04 Aug 2026',
    to: 'CAT LAI TERMINAL / CFS',
    deliverTo:
      'APEX LOGISTICS VIETNAM CO., LTD\n12 NGUYEN HUE, DISTRICT 1, HO CHI MINH CITY, VIETNAM',
    notifyParty: 'SAME AS DELIVER TO',
    mblNumber: 'SITC2628S001',
    hblNumber: IMPORT_AN_REF,
    etd: '10 Aug 2026',
    eta: '18 Aug 2026',
    shipmentNumber: 'IMP-SHP-260804',
    vesselVoyage: 'SITC OSAKA / 2628S',
    placeOfReceipt: 'YOKOHAMA, JP (JPYOK)',
    portOfLoading: 'YOKOHAMA, JP (JPYOK)',
    portOfDischarge: 'CAT LAI, HO CHI MINH, VN (VNSGN)',
    placeOfDelivery: 'CAT LAI, HO CHI MINH, VN (VNSGN)',
    finalDestination: 'HO CHI MINH CITY, VN',
    serviceMode: 'FCL / CY-CY',
    cfsTerminal: 'CAT LAI CFS',
    note: 'SEED IMPORT D/O — for workflow testing.',
    marks: 'N/M\nSITU2631620 / 40\'HC',
    volume: '1x40\'HC',
    customerAttention: 'Present original ID and D/O when collecting cargo.',
    cargoRows: [
      {
        containerSealNumber: 'SITU2631620 / SEAL998877',
        quantity: '1x40\'HC / 180 CTNS',
        descriptionOfGoods: 'ELECTRONIC COMPONENTS',
        grossWeight: '12,450 KGS',
        measurement: '58.20 CBM',
      },
    ],
  };
}

function exportArrivalNoticePayload() {
  return {
    agent: 'SEATRANS SHIPPING AGENCY',
    date: '04 Aug 2026',
    anNumber: EXPORT_AN_REF,
    shipper:
      'AN THINH STONE CO., LTD\n92 HAI BA TRUNG STREET, QUI NHON WARD, GIA LAI PROVINCE, VIETNAM',
    consignee:
      'SEKIGAHARA STONE CO., LTD.\n2682 SEKIGAHARA, FUWA-GUN, GIFU-KEN, 503-1595 JAPAN',
    notifyParty: 'SAME AS CONSIGNEE',
    mblNumber: 'SITC2615N088',
    hblNumber: EXPORT_AN_REF,
    vesselVoyage: 'SITC MINHE / 2615N',
    etdEta: 'ETD 14 Aug 2026 / ETA 22 Aug 2026',
    cfsTerminal: 'DA NANG CFS',
    shipmentNumber: 'EXP-SHP-260804',
    referenceNumber: EXPORT_REF,
    billOfLadingType: 'Original',
    placeOfReceipt: 'QUI NHON, VN (VNUIH)',
    portOfLoading: 'DA NANG, VN (VNDAD)',
    portOfDischarge: 'HAKATA, FUKUOKA, JP (JPHKT)',
    placeOfDelivery: 'HAKATA, FUKUOKA, JP (JPHKT)',
    finalDestination: 'HAKATA, JP',
    serviceMode: 'FCL / CY-CY',
    note: 'SEED EXPORT AN — for workflow testing.',
    marks: "FCL/FCL - CY/CY\nSITU2631620 / SITR892044 / 20'DC\nN/M",
    volume: '1x20\'DC',
    customerAttention: 'Original B/L to be released after freight collect.',
    cargoRows: [
      {
        containerSealNumber: "SITU2631620 / SITR892044 / 20'DC",
        quantity: '20 PALLET(S)',
        descriptionOfGoods: 'GRANITE STONES, BASALT STONES',
        grossWeight: '20,700 KGS',
        measurement: '7.26 CBM',
      },
    ],
  };
}

function exportBillOfLadingPayload() {
  return {
    fblNumber: EXPORT_BL_REF,
    consignor:
      'AN THINH STONE CO., LTD\n92 HAI BA TRUNG STREET, QUI NHON WARD, GIA LAI PROVINCE, VIETNAM\nTEL: +84-256-3 701 745',
    consignedToOrderOf:
      'SEKIGAHARA STONE CO., LTD.\n2682 SEKIGAHARA, FUWA-GUN, GIFU-KEN, 503-1595 JAPAN\n+81-584-43-5974',
    notifyAddress:
      'SEKIGAHARA STONE CO., LTD.\n2682 SEKIGAHARA, FUWA-GUN, GIFU-KEN, 503-1595 JAPAN\n+81-584-43-5974',
    placeOfReceipt: 'QUI NHON, VN (VNUIH)',
    oceanVessel: 'SITC MINHE',
    voyageNumber: '2615N',
    portOfLoading: 'DA NANG, VN (VNDAD)',
    portOfDischarge: 'HAKATA, FUKUOKA, JP (JPHKT)',
    placeOfDelivery: 'HAKATA, FUKUOKA, JP (JPHKT)',
    marksAndNumbers: "FCL/FCL - CY/CY\nSITU2631620/ SITR892044/ 20'DC\nN/M",
    numberAndKindOfPackages: '20 PALLET(S)',
    descriptionOfGoods:
      "AT SHIPPER'S LOAD, COUNT, STOW & SEAL\nSAID TO CONTAIN: ONE CONTAINER(S) ONLY\n1x20'DC\nGRANITE STONES, BASALT STONES\nHS CODE: 68010000",
    grossWeight: '20,700 KGS',
    measurement: '7.26 CBM',
    freightTerms: 'FREIGHT COLLECT',
    cleanOnBoard: 'CLEAN ON BOARD Aug 14, 2026',
    declarationOfInterest: '',
    declaredValue: '',
    freightAmount: 'AS ARRANGED',
    freightPayableAt: 'HAKATA, FUKUOKA, JP (JPHKT)',
    placeOfIssue: 'DA NANG, VN (VNDAD)',
    dateOfIssue: 'Aug 14, 2026',
    numberOfOriginals: 'THREE/3',
    cargoInsurance: 'not_covered',
    deliveryApplyTo:
      'APEX INTERNATIONAL INC.\n7F, TOYOKUNI BLDG, 2-4-6, SHIBA-DAIMON, MINATO-KU, TOKYO 105-0012 JAPAN',
    blFormVariant: 'surrendered',
  };
}

async function resolveUserId(client) {
  const preferred = await client.query(`
    SELECT u.id
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE COALESCE(u.is_active, TRUE) = TRUE
    ORDER BY
      CASE
        WHEN r.name ILIKE '%ADMIN%' THEN 0
        WHEN r.name ILIKE '%STAFF%' THEN 1
        ELSE 2
      END,
      u.id ASC
    LIMIT 1
  `);
  if (preferred.rows[0]?.id != null) return Number(preferred.rows[0].id);

  const fallback = await client.query(`
    SELECT id FROM users ORDER BY id ASC LIMIT 1
  `);
  if (fallback.rows[0]?.id == null) {
    throw new Error(
      'No users row found — create an admin/staff user before seeding',
    );
  }
  return Number(fallback.rows[0].id);
}

async function findActiveByRef(client, referenceNumber) {
  const result = await client.query(
    `
    SELECT id, document_type, booking_flow, booking_id, reference_number, status
    FROM booking_document_records
    WHERE reference_number = $1
      AND deleted_at IS NULL
    ORDER BY id DESC
    LIMIT 1
    `,
    [referenceNumber],
  );
  return result.rows[0] ?? null;
}

async function softDeleteByRefs(client, refs, actorUserId) {
  await client.query(
    `
    UPDATE booking_document_records
    SET deleted_at = NOW(),
        deleted_by_user_id = $2
    WHERE reference_number = ANY($1::text[])
      AND deleted_at IS NULL
    `,
    [refs, actorUserId],
  );
}

async function insertBooking(client, { flow, payload, userId }) {
  const result = await client.query(
    `
    INSERT INTO booking_document_records (
      document_type,
      booking_flow,
      booking_id,
      reference_number,
      payload,
      status,
      created_by_user_id,
      updated_by_user_id,
      created_at,
      updated_at
    ) VALUES (
      'booking',
      $1,
      NULL,
      $2,
      $3::jsonb,
      'COMPLETED',
      $4,
      $4,
      NOW(),
      NOW()
    )
    RETURNING id, document_type, booking_flow, reference_number, status
    `,
    [flow, payload.bookingNumber, JSON.stringify(payload), userId],
  );
  return result.rows[0];
}

async function insertChild(
  client,
  { documentType, bookingId, referenceNumber, payload, userId },
) {
  const result = await client.query(
    `
    INSERT INTO booking_document_records (
      document_type,
      booking_flow,
      booking_id,
      reference_number,
      payload,
      status,
      created_by_user_id,
      updated_by_user_id,
      created_at,
      updated_at
    ) VALUES (
      $1,
      NULL,
      $2,
      $3,
      $4::jsonb,
      'COMPLETED',
      $5,
      $5,
      NOW(),
      NOW()
    )
    RETURNING id, document_type, booking_id, reference_number, status
    `,
    [
      documentType,
      bookingId,
      referenceNumber,
      JSON.stringify(payload),
      userId,
    ],
  );
  return result.rows[0];
}

async function main() {
  loadEnv(join(root, '.env'));
  loadEnv(join(root, '.env.local'));

  const config = buildClientConfig();
  const args = parseArgs(process.argv.slice(2));
  const client = new pg.Client(config);

  await client.connect();
  try {
    const schema = await client.query(`
    SELECT
      current_database() AS database,
      to_regclass('public.booking_document_records') IS NOT NULL AS has_table,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'booking_document_records'
          AND column_name = 'booking_flow'
      ) AS has_booking_flow
  `);
    const state = schema.rows[0];
    if (!state?.has_table) {
      throw new Error('booking_document_records table does not exist');
    }
    if (!state?.has_booking_flow) {
      throw new Error(
        'booking_flow column missing — run scripts/apply-booking-workflows.mjs first',
      );
    }

    const userId = await resolveUserId(client);
    const allSeedRefs = [
      IMPORT_REF,
      EXPORT_REF,
      IMPORT_AN_REF,
      IMPORT_DO_REF,
      EXPORT_AN_REF,
      EXPORT_BL_REF,
    ];

    const existingImport = await findActiveByRef(client, IMPORT_REF);
    const existingExport = await findActiveByRef(client, EXPORT_REF);

    if ((existingImport || existingExport) && !args.force) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            skipped: true,
            reason:
              'Seed refs already exist (pass --force to soft-delete and re-insert)',
            seedTag: SEED_TAG,
            database: state.database,
            createdByUserId: userId,
            existing: {
              import: existingImport,
              export: existingExport,
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    await client.query('BEGIN');
    if (args.force) {
      await softDeleteByRefs(client, allSeedRefs, userId);
    }

    const importBooking = await insertBooking(client, {
      flow: 'IMPORT',
      payload: importBookingPayload(),
      userId,
    });
    const exportBooking = await insertBooking(client, {
      flow: 'EXPORT',
      payload: exportBookingPayload(),
      userId,
    });

    const children = [];
    if (args.withChildren) {
      children.push(
        await insertChild(client, {
          documentType: 'an',
          bookingId: importBooking.id,
          referenceNumber: IMPORT_AN_REF,
          payload: importArrivalNoticePayload(),
          userId,
        }),
        await insertChild(client, {
          documentType: 'do',
          bookingId: importBooking.id,
          referenceNumber: IMPORT_DO_REF,
          payload: importDeliveryOrderPayload(),
          userId,
        }),
        await insertChild(client, {
          documentType: 'an',
          bookingId: exportBooking.id,
          referenceNumber: EXPORT_AN_REF,
          payload: exportArrivalNoticePayload(),
          userId,
        }),
        await insertChild(client, {
          documentType: 'bl',
          bookingId: exportBooking.id,
          referenceNumber: EXPORT_BL_REF,
          payload: exportBillOfLadingPayload(),
          userId,
        }),
      );
    }

    await client.query('COMMIT');

    console.log(
      JSON.stringify(
        {
          ok: true,
          seedTag: SEED_TAG,
          database: state.database,
          host:
            config.host === 'localhost' || config.host === '127.0.0.1'
              ? config.host
              : '***',
          createdByUserId: userId,
          withChildren: args.withChildren,
          inserted: {
            importBooking,
            exportBooking,
            children,
          },
          uiHints: {
            history: '/booking/documents/history',
            openImport: `/booking/documents/booking-confirmation?flow=IMPORT&bookingId=${importBooking.id}&recordId=${importBooking.id}`,
            openExport: `/booking/documents/booking-confirmation?flow=EXPORT&bookingId=${exportBooking.id}&recordId=${exportBooking.id}`,
          },
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
