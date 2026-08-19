import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const PROJECT_ROOT = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-08-19_commodity_types_expand.sql',
);
const ENTITY_PATH = join(
  PROJECT_ROOT,
  'src',
  'features',
  'commodities',
  'entities',
  'commodity-type.entity.ts',
);
const MODULE_PATH = join(
  PROJECT_ROOT,
  'src',
  'features',
  'commodities',
  'commodities.module.ts',
);
const MIGRATION_ID = '2026-08-19_commodity_types_expand_v1';
const CONFIRMATION = 'APPLY_COMMODITY_TYPES_EXPAND_20260819';
const LOCK_NAME = 'seatrans:commodity-types-expand:2026-08-19';
const DATA_SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-08-19_commodity_types_data.sql',
);
const DATA_MIGRATION_ID = '2026-08-19_commodity_types_data_v1';
const DATA_CONFIRMATION = 'APPLY_COMMODITY_TYPES_DATA_20260819';
const DATA_LOCK_NAME = 'seatrans:commodity-types-data:2026-08-19';
const GALLERY_SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-08-19_gallery_commodity_type_expand.sql',
);
const GALLERY_MIGRATION_ID = '2026-08-19_gallery_commodity_type_expand_v1';
const GALLERY_CONFIRMATION = 'APPLY_GALLERY_COMMODITY_TYPE_EXPAND_20260819';
const GALLERY_LOCK_NAME = 'seatrans:gallery-commodity-type-expand:2026-08-19';
const INQUIRY_SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-08-19_shipping_inquiry_commodity_ids_expand.sql',
);
const INQUIRY_MIGRATION_ID =
  '2026-08-19_shipping_inquiry_commodity_ids_expand_v1';
const INQUIRY_CONFIRMATION = 'APPLY_SHIPPING_INQUIRY_COMMODITY_IDS_20260819';
const INQUIRY_LOCK_NAME = 'seatrans:shipping-inquiry-commodity-ids:2026-08-19';
const DUPLICATE_DATA_SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-08-19_independent_commodities_data.sql',
);
const DUPLICATE_DATA_MIGRATION_ID =
  '2026-08-19_independent_commodities_data_v1';
const DUPLICATE_DATA_CONFIRMATION =
  'APPLY_INDEPENDENT_COMMODITIES_DATA_20260819';
const DUPLICATE_DATA_LOCK_NAME =
  'seatrans:independent-commodities-data:2026-08-19';
const CONTRACT_SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-08-19_commodity_groups_contract.sql',
);
const CONTRACT_MIGRATION_ID = '2026-08-19_commodity_groups_contract_v1';
const CONTRACT_CONFIRMATION = 'APPLY_COMMODITY_GROUPS_CONTRACT_20260819';
const CONTRACT_LOCK_NAME = 'seatrans:commodity-groups-contract:2026-08-19';
const DOCUMENT_PAYLOAD_TABLES = [
  'booking_records',
  'arrival_notice_records',
  'delivery_order_records',
  'bill_of_lading_records',
];

export function buildIndependentCommodityMergePlan(snapshot) {
  const referenceCounts = commodityReferenceCounts(snapshot);
  const groups = new Map();
  for (const commodity of snapshot.commodities) {
    const key = `${commodity.serviceTypeId}:${normalizeCommodityName(commodity.name)}`;
    const rows = groups.get(key) ?? [];
    rows.push(commodity);
    groups.set(key, rows);
  }

  const mergeMap = [];
  const canonicalDescriptions = [];
  for (const rows of groups.values()) {
    const ranked = [...rows].sort(
      (left, right) =>
        (referenceCounts.get(right.id) ?? 0) -
          (referenceCounts.get(left.id) ?? 0) || left.id - right.id,
    );
    const canonical = ranked[0];
    for (const duplicate of ranked.slice(1)) {
      mergeMap.push({
        duplicateId: duplicate.id,
        canonicalId: canonical.id,
      });
    }
    const description = ranked
      .map((row) => normalizedDescription(row.description))
      .find((value) => value != null);
    canonicalDescriptions.push({
      canonicalId: canonical.id,
      description: description ?? null,
    });
  }
  mergeMap.sort((left, right) => left.duplicateId - right.duplicateId);
  canonicalDescriptions.sort(
    (left, right) => left.canonicalId - right.canonicalId,
  );
  return { mergeMap, canonicalDescriptions, referenceCounts };
}

export function applyIndependentCommodityMergeFixture(snapshot, plan) {
  const next = cloneJson(snapshot);
  const canonicalByDuplicate = new Map(
    plan.mergeMap.map((row) => [row.duplicateId, row.canonicalId]),
  );
  const canonicalDescription = new Map(
    plan.canonicalDescriptions.map((row) => [row.canonicalId, row.description]),
  );
  const rewrite = (value) => {
    const id = numericCommodityId(value);
    return id == null ? value : (canonicalByDuplicate.get(id) ?? id);
  };

  next.galleryImages = next.galleryImages.map((row) => ({
    ...row,
    commodityId: rewrite(row.commodityId),
  }));
  next.shippingInquiries = next.shippingInquiries.map((row) => ({
    ...row,
    commodityId: rewrite(row.commodityId),
  }));
  next.documents = Object.fromEntries(
    Object.entries(next.documents).map(([table, rows]) => [
      table,
      rows.map((row) => ({
        ...row,
        payload: Object.prototype.hasOwnProperty.call(
          row.payload,
          'commodityId',
        )
          ? {
              ...row.payload,
              commodityId: rewrite(row.payload.commodityId),
            }
          : { ...row.payload },
      })),
    ]),
  );
  const duplicateIds = new Set(plan.mergeMap.map((row) => row.duplicateId));
  next.commodities = next.commodities
    .filter((row) => !duplicateIds.has(row.id))
    .map((row) => ({
      ...row,
      description: canonicalDescription.has(row.id)
        ? canonicalDescription.get(row.id)
        : normalizedDescription(row.description),
    }));
  return next;
}

export function summarizeIndependentCommodityState(snapshot) {
  const ids = new Set(snapshot.commodities.map((row) => row.id));
  const duplicateGroups = [];
  const groups = new Map();
  for (const commodity of snapshot.commodities) {
    const key = `${commodity.serviceTypeId}:${normalizeCommodityName(commodity.name)}`;
    const rows = groups.get(key) ?? [];
    rows.push(commodity.id);
    groups.set(key, rows);
  }
  for (const [key, commodityIds] of groups) {
    if (commodityIds.length > 1) {
      duplicateGroups.push({ key, commodityIds: [...commodityIds].sort() });
    }
  }
  const orphanReferences = allCommodityReferences(snapshot)
    .filter((reference) => !ids.has(reference.commodityId))
    .sort((left, right) => left.location.localeCompare(right.location));
  const stableSnapshot = stableRecoverySnapshot(snapshot);
  return {
    commodityCount: snapshot.commodities.length,
    duplicateGroups,
    orphanReferences,
    referenceCounts: Object.fromEntries(
      [...commodityReferenceCounts(snapshot)].sort(
        ([left], [right]) => left - right,
      ),
    ),
    galleryReferenceCounts: Object.fromEntries(
      countIds(snapshot.galleryImages.map((row) => row.commodityId)),
    ),
    rowChecksum: checksumJson(stableSnapshot),
    textSnapshotChecksum: checksumJson(textOnlySnapshot(snapshot)),
  };
}

export function validateIndependentCommodityDataPreflight(before, plan) {
  const expectedMergeCount = before.duplicateGroups.reduce(
    (total, group) => total + group.commodityIds.length - 1,
    0,
  );
  const blockers = {
    orphanReferences: before.orphanReferences,
    invalidDuplicatePlan:
      plan.mergeMap.length === expectedMergeCount
        ? []
        : ['merge map must contain exactly one entry per duplicate row'],
  };
  const pke = plan.mergeMap.find(
    (row) => row.duplicateId === 37 || row.canonicalId === 37,
  );
  if (pke && (pke.duplicateId !== 37 || pke.canonicalId !== 19)) {
    blockers.confirmedPke = ['ID 37 must merge into canonical ID 19'];
  }
  if (Object.values(blockers).some((rows) => rows.length > 0)) {
    throw new Error(
      `Independent Commodity data preflight blockers: ${JSON.stringify(blockers)}`,
    );
  }
}

export function validateIndependentCommodityDataPostflight(
  before,
  after,
  plan,
) {
  if (after.commodityCount !== before.commodityCount - plan.mergeMap.length) {
    throw new Error('Postflight: Commodity count reduction is unexpected');
  }
  if (after.duplicateGroups.length > 0) {
    throw new Error('Postflight: normalized Commodity duplicates remain');
  }
  if (after.orphanReferences.length > 0) {
    throw new Error('Postflight: orphan Commodity references remain');
  }
  if (after.textSnapshotChecksum !== before.textSnapshotChecksum) {
    throw new Error('Postflight: historical text snapshots changed');
  }
  if (before.commodityCount === 29) {
    if (after.commodityCount !== 28) {
      throw new Error(
        'Postflight: current Commodity snapshot must contain 28 rows',
      );
    }
    if (Number(after.galleryReferenceCounts[19] ?? 0) !== 9) {
      throw new Error(
        'Postflight: current PKE Gallery references must remain 9',
      );
    }
  }
}

export async function collectIndependentCommodityRecoverySnapshot(client) {
  const commodities = (
    await client.query(`SELECT id, service_type_id AS "serviceTypeId", name,
      display_name AS "displayName", description FROM commodities ORDER BY id`)
  ).rows;
  const galleryImages = (
    await client.query(`SELECT id, commodity_id AS "commodityId", image_url AS "imageUrl"
      FROM gallery_images ORDER BY id`)
  ).rows;
  const inquiryColumn = (
    await client.query(`SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'shipping_agency_inquiries'
        AND column_name = 'commodity_id'
    ) AS exists`)
  ).rows[0]?.exists;
  const shippingInquiries = inquiryColumn
    ? (
        await client.query(`SELECT id, commodity_id AS "commodityId", cargo_name AS "cargoName"
          FROM shipping_agency_inquiries ORDER BY id`)
      ).rows
    : [];
  const documents = {};
  for (const table of DOCUMENT_PAYLOAD_TABLES) {
    documents[table] = (
      await client.query(`SELECT id, payload FROM ${table} ORDER BY id`)
    ).rows;
  }
  return {
    commodities,
    galleryImages,
    shippingInquiries,
    documents,
  };
}

export function createIndependentCommodityRecoveryEnvelope(snapshot, evidence) {
  const exactSnapshot = cloneJson(snapshot);
  return {
    format: 'seatrans-independent-commodities-recovery-v1',
    scope: [
      'commodities',
      'gallery_images',
      'shipping_agency_inquiries',
      ...DOCUMENT_PAYLOAD_TABLES,
    ],
    checksum: checksumJson(exactSnapshot),
    snapshot: exactSnapshot,
    evidence: {
      backupReference: evidence.backupReference,
      restoreTested: evidence.restoreTested === true,
      rollForwardTested: evidence.rollForwardTested === true,
      restoreTestReference: evidence.restoreTestReference,
      rollForwardTestReference: evidence.rollForwardTestReference,
      restoreProcedure:
        'Restore exported rows in one transaction, references first only after duplicate rows exist.',
      rollForwardProcedure:
        'Fix the blocker, then rerun duplicate-data; deterministic merge and ID rewrites are idempotent.',
    },
  };
}

export function writeIndependentCommodityRecoveryExport(path, envelope) {
  writeFileSync(path, `${JSON.stringify(envelope, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return readIndependentCommodityRecoveryExport(path);
}

export function readIndependentCommodityRecoveryExport(path) {
  const envelope = JSON.parse(readFileSync(path, 'utf8'));
  if (envelope.format !== 'seatrans-independent-commodities-recovery-v1') {
    throw new Error('Recovery export format is unsupported');
  }
  if (checksumJson(envelope.snapshot) !== envelope.checksum) {
    throw new Error('Recovery export checksum mismatch');
  }
  if (
    envelope.evidence?.restoreTested !== true ||
    envelope.evidence?.rollForwardTested !== true ||
    !String(envelope.evidence?.restoreTestReference ?? '').trim() ||
    !String(envelope.evidence?.rollForwardTestReference ?? '').trim()
  ) {
    throw new Error('Recovery export lacks restore/roll-forward evidence');
  }
  return envelope;
}

export function verifyDuplicateDataApplyGuards(args, config) {
  if (!args.apply) return null;
  if (!args.targetDb || args.targetDb !== config.database) {
    throw new Error(
      '--target-db must exactly match the configured database name',
    );
  }
  if (!args.backupReference?.trim()) {
    throw new Error('--backup-reference is required for --apply');
  }
  if (!args.restoreTestReference?.trim()) {
    throw new Error(
      '--restore-test-reference is required for duplicate-data --apply',
    );
  }
  if (!args.rollForwardTestReference?.trim()) {
    throw new Error(
      '--roll-forward-test-reference is required for duplicate-data --apply',
    );
  }
  if (args.confirmation !== DUPLICATE_DATA_CONFIRMATION) {
    throw new Error(`--confirm must equal ${DUPLICATE_DATA_CONFIRMATION}`);
  }
  if (!args.logicalExport || !isAbsolute(args.logicalExport)) {
    throw new Error('--logical-export must be an absolute path');
  }
  const path = resolve(args.logicalExport);
  const projectRelative = relative(PROJECT_ROOT, path);
  if (
    projectRelative === '' ||
    (!projectRelative.startsWith('..') && !isAbsolute(projectRelative))
  ) {
    throw new Error('--logical-export must be stored outside backend2.0');
  }
  if (!statSync(dirname(path)).isDirectory()) {
    throw new Error('--logical-export parent must be an existing directory');
  }
  if (existsSync(path)) {
    throw new Error('--logical-export refuses to overwrite an existing file');
  }
  return {
    path,
    backupReference: args.backupReference.trim(),
    restoreTestReference: args.restoreTestReference.trim(),
    rollForwardTestReference: args.rollForwardTestReference.trim(),
  };
}

function normalizeCommodityName(value) {
  return String(value ?? '')
    .trim()
    .replace(/[\s_/-]+/g, ' ')
    .toLocaleLowerCase('en-US');
}

function normalizedDescription(value) {
  const normalized = String(value ?? '').trim();
  return !normalized || normalized.toUpperCase() === 'NULL' ? null : normalized;
}

function numericCommodityId(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function commodityReferenceCounts(snapshot) {
  return countIds(
    allCommodityReferences(snapshot).map((row) => row.commodityId),
  );
}

function countIds(values) {
  const counts = new Map();
  for (const value of values) {
    const id = numericCommodityId(value);
    if (id != null) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function allCommodityReferences(snapshot) {
  const references = [];
  for (const row of snapshot.galleryImages) {
    const commodityId = numericCommodityId(row.commodityId);
    if (commodityId != null) {
      references.push({ commodityId, location: `gallery_images:${row.id}` });
    }
  }
  for (const row of snapshot.shippingInquiries) {
    const commodityId = numericCommodityId(row.commodityId);
    if (commodityId != null) {
      references.push({
        commodityId,
        location: `shipping_agency_inquiries:${row.id}`,
      });
    }
  }
  for (const [table, rows] of Object.entries(snapshot.documents)) {
    for (const row of rows) {
      const commodityId = numericCommodityId(row.payload?.commodityId);
      if (commodityId != null) {
        references.push({ commodityId, location: `${table}:${row.id}` });
      }
    }
  }
  return references;
}

function textOnlySnapshot(snapshot) {
  return {
    galleryImages: snapshot.galleryImages.map(
      ({ commodityId: _id, ...row }) => row,
    ),
    shippingInquiries: snapshot.shippingInquiries.map(
      ({ commodityId: _id, ...row }) => row,
    ),
    documents: Object.fromEntries(
      Object.entries(snapshot.documents).map(([table, rows]) => [
        table,
        rows.map((row) => {
          const { commodityId: _id, ...payload } = row.payload;
          return { ...row, payload };
        }),
      ]),
    ),
  };
}

function stableRecoverySnapshot(snapshot) {
  return {
    commodities: [...snapshot.commodities].sort((a, b) => a.id - b.id),
    galleryImages: [...snapshot.galleryImages].sort((a, b) => a.id - b.id),
    shippingInquiries: [...snapshot.shippingInquiries].sort(
      (a, b) => a.id - b.id,
    ),
    documents: Object.fromEntries(
      DOCUMENT_PAYLOAD_TABLES.map((table) => [
        table,
        [...(snapshot.documents[table] ?? [])].sort((a, b) => a.id - b.id),
      ]),
    ),
  };
}

function checksumJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function validateInquiryIdsExpandPreflight(report) {
  const blockers = {
    missingInquiry: report.inquiryTableExists
      ? []
      : ['shipping_agency_inquiries'],
    missingTypes: report.commodityTypesTableExists ? [] : ['commodity_types'],
    missingCommodities: report.commoditiesTableExists ? [] : ['commodities'],
    partialColumns: report.partialColumns
      ? ['commodity_type_id and commodity_id must be expanded together']
      : [],
    incompatibleColumns:
      report.columnsExist && !report.idsNullable
        ? ['identity columns must be nullable integers']
        : [],
    linkedConstraint: report.linkedConstraintExists
      ? ['commodity_type_id + commodity_id']
      : [],
  };
  if (Object.values(blockers).some((rows) => rows.length > 0)) {
    throw new Error(
      `Inquiry IDs expand preflight blockers: ${JSON.stringify(blockers)}`,
    );
  }
}

export function validateInquiryIdsExpandPostflight(before, after) {
  validateInquiryIdsExpandPreflight(after);
  if (!after.columnsExist || !after.idsNullable) {
    throw new Error(
      'Postflight: inquiry identity columns must exist and be nullable',
    );
  }
  if (
    !after.typeFkExists ||
    !after.commodityFkExists ||
    !after.typeFkValid ||
    !after.commodityFkValid
  ) {
    throw new Error(
      'Postflight: independent inquiry FKs are missing or invalid',
    );
  }
  if (
    after.typeFkDeleteAction !== 'r' ||
    after.commodityFkDeleteAction !== 'r'
  ) {
    throw new Error('Postflight: inquiry FKs must use ON DELETE RESTRICT');
  }
  if (!after.typeIndexExists || !after.commodityIndexExists) {
    throw new Error('Postflight: inquiry identity indexes are missing');
  }
  if (
    before.rowCount !== after.rowCount ||
    before.rowChecksum !== after.rowChecksum
  ) {
    throw new Error('Postflight: inquiry rows changed during expand');
  }
  if (
    after.nullTypeCount !== before.nullTypeCount ||
    after.nullCommodityCount !== before.nullCommodityCount
  ) {
    throw new Error(
      'Postflight: legacy inquiry ID columns were unexpectedly backfilled',
    );
  }
}

export function validateGalleryTypeExpandPreflight(report) {
  const blockers = {
    missingGalleryTable: report.galleryTableExists ? [] : ['gallery_images'],
    missingCommodityTypesTable: report.commodityTypesTableExists
      ? []
      : ['commodity_types'],
    incompatibleColumn:
      report.columnExists &&
      (report.columnType !== 'integer' || report.columnNullable !== true)
        ? ['gallery_images.commodity_type_id must be nullable integer']
        : [],
    assignmentTable: report.assignmentTableExists
      ? ['commodity_type_assignments']
      : [],
    compositeConstraint: report.compositeConstraintExists
      ? ['commodity_id + commodity_type_id']
      : [],
    fkNameConflict: report.fkNameConflict ? [report.fkNameConflict] : [],
    indexNameConflict: report.indexNameConflict
      ? [report.indexNameConflict]
      : [],
  };
  if (Object.values(blockers).some((rows) => rows.length > 0)) {
    throw new Error(
      `Gallery Type expand preflight blockers: ${JSON.stringify(blockers)}`,
    );
  }
}

export function validateGalleryTypeExpandPostflight(before, after) {
  validateGalleryTypeExpandPreflight(after);
  if (!after.columnExists || !after.columnNullable) {
    throw new Error('Postflight: commodity_type_id must exist and be nullable');
  }
  if (!after.fkExists || !after.fkValid || after.fkDeleteAction !== 'r') {
    throw new Error(
      'Postflight: Commodity Type RESTRICT FK is missing or invalid',
    );
  }
  if (!after.indexExists) {
    throw new Error('Postflight: Commodity Type index is missing');
  }
  if (
    before.rowCount !== after.rowCount ||
    before.rowChecksum !== after.rowChecksum
  ) {
    throw new Error('Postflight: gallery image rows changed during expand');
  }
}

export function canonicalCommodityTypeCode(value) {
  const token = normalizeCatalogToken(value);
  if (!token) return '';
  if (token === 'EQUIPMENT') return 'IN_EQUIPMENT';
  return token.startsWith('IN_') ? token : `IN_${token}`;
}

function normalizeCatalogToken(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeDisplayName(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function buildCommodityTypeCandidates({
  groups,
  cargoTypes,
  serviceTypes,
}) {
  const serviceByToken = new Map();
  for (const service of serviceTypes) {
    serviceByToken.set(normalizeCatalogToken(service.name), service.id);
    serviceByToken.set(normalizeCatalogToken(service.displayName), service.id);
  }
  const sources = [];
  for (const group of groups) {
    if (!serviceTypes.some((service) => service.id === group.serviceTypeId)) {
      continue;
    }
    sources.push({
      serviceTypeId: group.serviceTypeId,
      code: canonicalCommodityTypeCode(group.name),
      name: normalizeDisplayName(group.name),
      source: 'commodity_groups',
      sourceId: group.id,
      priority: 1,
    });
  }
  for (const [index, cargoType] of cargoTypes.entries()) {
    const serviceTypeId = serviceByToken.get(
      normalizeCatalogToken(cargoType.serviceTypeType),
    );
    if (serviceTypeId == null) continue;
    sources.push({
      serviceTypeId,
      code: canonicalCommodityTypeCode(cargoType.code),
      name: normalizeDisplayName(cargoType.displayLabel || cargoType.code),
      source: 'cargo_types',
      sourceId: index + 1,
      priority: 2,
    });
  }
  const byCode = new Map();
  for (const source of sources) {
    if (!source.code || !source.name) continue;
    const key = `${source.serviceTypeId}:${source.code.toLowerCase()}`;
    if (!byCode.has(key)) byCode.set(key, source);
  }
  return [...byCode.values()].sort(
    (left, right) =>
      left.serviceTypeId - right.serviceTypeId ||
      left.priority - right.priority ||
      left.sourceId - right.sourceId,
  );
}

export function summarizeCommodityTypeBackfill(input) {
  const candidates = buildCommodityTypeCandidates(input);
  const serviceIds = new Set(input.serviceTypes.map((service) => service.id));
  const serviceTokens = new Set(
    input.serviceTypes.flatMap((service) => [
      normalizeCatalogToken(service.name),
      normalizeCatalogToken(service.displayName),
    ]),
  );
  const unresolvedServices = [
    ...input.groups
      .filter((group) => !serviceIds.has(group.serviceTypeId))
      .map((group) => ({ source: 'commodity_groups', id: group.id })),
    ...input.cargoTypes
      .filter(
        (cargoType) =>
          !serviceTokens.has(normalizeCatalogToken(cargoType.serviceTypeType)),
      )
      .map((cargoType) => ({
        source: 'cargo_types',
        code: cargoType.code,
        serviceTypeType: cargoType.serviceTypeType,
      })),
  ];
  const catalogByCode = new Map(
    input.catalogTypes.map((row) => [
      `${row.serviceTypeId}:${normalizeStoredCode(row.code)}`,
      row,
    ]),
  );
  const catalogByName = new Map(
    input.catalogTypes.map((row) => [
      `${row.serviceTypeId}:${normalizeDisplayName(row.name).toLowerCase()}`,
      row,
    ]),
  );
  const missingCandidates = candidates.filter(
    (candidate) =>
      !catalogByCode.has(
        `${candidate.serviceTypeId}:${normalizeStoredCode(candidate.code)}`,
      ),
  );
  const conflictingExistingNames = missingCandidates.flatMap((candidate) => {
    const row = catalogByName.get(
      `${candidate.serviceTypeId}:${candidate.name.toLowerCase()}`,
    );
    return row ? [{ candidate, existing: row }] : [];
  });
  const candidateNames = new Map();
  const duplicateCandidateNames = [];
  for (const candidate of candidates) {
    const key = `${candidate.serviceTypeId}:${candidate.name.toLowerCase()}`;
    const previous = candidateNames.get(key);
    if (previous && previous.code !== candidate.code) {
      duplicateCandidateNames.push({ previous, candidate });
    } else {
      candidateNames.set(key, candidate);
    }
  }
  const duplicateCatalogCodes = duplicateCatalogKeys(
    input.catalogTypes,
    (row) => normalizeStoredCode(row.code),
  );
  const duplicateCatalogNames = duplicateCatalogKeys(
    input.catalogTypes,
    (row) => normalizeDisplayName(row.name).toLowerCase(),
  );
  return {
    sourceCounts: {
      commodityGroups: input.groups.length,
      cargoTypes: input.cargoTypes.length,
      candidates: candidates.length,
    },
    catalogCount: input.catalogTypes.length,
    candidates,
    missingCandidates,
    unresolvedServices,
    conflictingExistingNames,
    duplicateCandidateNames,
    duplicateCatalogCodes,
    duplicateCatalogNames,
    groupSnapshot: input.groupSnapshot,
    commoditySnapshot: input.commoditySnapshot,
  };
}

function normalizeStoredCode(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function duplicateCatalogKeys(rows, keyOf) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.serviceTypeId}:${keyOf(row)}`;
    const values = grouped.get(key) ?? [];
    values.push(row.id);
    grouped.set(key, values);
  }
  return [...grouped.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
}

export function validateCommodityTypeBackfillPreflight(summary) {
  const blockers = {
    unresolvedServices: summary.unresolvedServices,
    conflictingExistingNames: summary.conflictingExistingNames,
    duplicateCandidateNames: summary.duplicateCandidateNames,
    duplicateCatalogCodes: summary.duplicateCatalogCodes,
    duplicateCatalogNames: summary.duplicateCatalogNames,
  };
  if (Object.values(blockers).some((rows) => rows.length > 0)) {
    throw new Error(
      `Commodity Type data preflight blockers: ${JSON.stringify(blockers)}`,
    );
  }
}

export function validateCommodityTypeBackfillPostflight(before, after) {
  validateCommodityTypeBackfillPreflight(after);
  if (after.missingCandidates.length > 0) {
    throw new Error(
      `Commodity Type data postflight has unresolved candidates: ${JSON.stringify(after.missingCandidates)}`,
    );
  }
  if (
    after.catalogCount !==
    before.catalogCount + before.missingCandidates.length
  ) {
    throw new Error(
      'Commodity Type data postflight count growth is unexpected',
    );
  }
  if (
    JSON.stringify(before.groupSnapshot) !== JSON.stringify(after.groupSnapshot)
  ) {
    throw new Error('commodity_groups changed during Type backfill');
  }
  if (
    JSON.stringify(before.commoditySnapshot) !==
    JSON.stringify(after.commoditySnapshot)
  ) {
    throw new Error('commodities changed during Type backfill');
  }
}

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

function parseArgs(argv) {
  const args = {
    apply: false,
    verifyStatic: false,
    phase: 'expand',
    targetDb: null,
    backupReference: null,
    logicalExport: null,
    observationReference: null,
    restoreTestReference: null,
    rollForwardTestReference: null,
    confirmation: null,
  };
  for (const argument of argv) {
    if (argument === '--apply') args.apply = true;
    else if (argument === '--dry-run') continue;
    else if (argument === '--verify-static') args.verifyStatic = true;
    else {
      const [key, ...parts] = argument.split('=');
      const value = parts.join('=');
      if (key === '--target-db') args.targetDb = value;
      else if (
        key === '--phase' &&
        [
          'expand',
          'data',
          'gallery-expand',
          'inquiry-expand',
          'duplicate-data',
          'contract',
        ].includes(value)
      )
        args.phase = value;
      else if (key === '--backup-reference') args.backupReference = value;
      else if (key === '--logical-export') args.logicalExport = value;
      else if (key === '--observation-reference')
        args.observationReference = value;
      else if (key === '--restore-test-reference')
        args.restoreTestReference = value;
      else if (key === '--roll-forward-test-reference')
        args.rollForwardTestReference = value;
      else if (key === '--confirm') args.confirmation = value;
      else throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (args.apply && args.verifyStatic) {
    throw new Error('--apply and --verify-static are mutually exclusive');
  }
  return args;
}

function verifyStaticContract() {
  const sql = readFileSync(SQL_PATH, 'utf8');
  const executableSql = sql.replace(/--.*$/gm, '');
  const entity = readFileSync(ENTITY_PATH, 'utf8');
  const module = readFileSync(MODULE_PATH, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS (?:public\.)?commodity_types/i);
  assert.match(sql, /REFERENCES (?:public\.)?service_types\s*\(id\)/i);
  assert.match(sql, /ON DELETE RESTRICT/i);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_commodity_types_service_code_normalized[\s\S]*lower\s*\(\s*btrim\s*\(\s*code\s*\)/i,
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_commodity_types_service_name_normalized[\s\S]*lower\s*\(\s*btrim\s*\(\s*name\s*\)/i,
  );
  assert.doesNotMatch(
    executableSql,
    /\b(?:DROP|TRUNCATE|UPDATE)\b|\bDELETE\s+FROM\b/i,
  );
  assert.doesNotMatch(executableSql, /commodity_type_assignments/i);
  assert.doesNotMatch(
    executableSql,
    /(?:ALTER|CREATE\s+(?:UNIQUE\s+)?INDEX)[\s\S]{0,100}\bcommodities\b/i,
  );
  assert.doesNotMatch(
    executableSql,
    /(?:ALTER|DROP|TRUNCATE|DELETE\s+FROM|UPDATE)\s+(?:TABLE\s+)?(?:public\.)?commodity_groups/i,
  );

  assert.match(entity, /@Entity\('commodity_types'\)/);
  assert.match(entity, /serviceTypeId/);
  assert.match(entity, /code/);
  assert.match(entity, /name/);
  assert.match(module, /import \{ CommodityType \}/);
  assert.match(module, /TypeOrmModule\.forFeature\(\[[\s\S]*CommodityType/);

  const emptyCatalogReport = fixtureReport({
    commodityTypesExists: false,
    columns: [],
    constraints: [],
    indexes: [],
  });
  assert.doesNotThrow(() => validatePreflight(emptyCatalogReport));

  const expandedReport = fixtureReport();
  assert.doesNotThrow(() =>
    validatePostflight(emptyCatalogReport, expandedReport),
  );
  assert.throws(
    () =>
      validatePostflight(emptyCatalogReport, {
        ...expandedReport,
        groupSnapshot: { ...expandedReport.groupSnapshot, rowCount: 7 },
      }),
    /commodity_groups changed/,
  );

  return {
    sqlChecksum: createHash('sha256').update(sql).digest('hex'),
    checks: 18,
  };
}

function fixtureReport(overrides = {}) {
  return {
    serviceTypesExists: true,
    commodityTypesExists: true,
    commodityGroupsExists: true,
    assignmentsExists: false,
    prohibitedCommodityFk: false,
    columns: [
      columnFixture('id', 'integer'),
      columnFixture('service_type_id', 'integer'),
      columnFixture('code', 'character varying', 100),
      columnFixture('name', 'character varying', 200),
      columnFixture('created_at', 'timestamp with time zone'),
      columnFixture('updated_at', 'timestamp with time zone'),
    ],
    constraints: [
      constraintFixture('commodity_types_pkey', 'p', 'PRIMARY KEY (id)'),
      constraintFixture(
        'fk_commodity_types_service_type',
        'f',
        'FOREIGN KEY (service_type_id) REFERENCES service_types(id) ON DELETE RESTRICT',
      ),
      constraintFixture(
        'ck_commodity_types_code_nonblank',
        'c',
        "CHECK (btrim(code) <> ''::text)",
      ),
      constraintFixture(
        'ck_commodity_types_name_nonblank',
        'c',
        "CHECK (btrim(name) <> ''::text)",
      ),
    ],
    indexes: [
      {
        indexname: 'uq_commodity_types_service_code_normalized',
        indexdef:
          'CREATE UNIQUE INDEX uq_commodity_types_service_code_normalized ON commodity_types USING btree (service_type_id, lower(btrim(code)))',
      },
      {
        indexname: 'uq_commodity_types_service_name_normalized',
        indexdef:
          'CREATE UNIQUE INDEX uq_commodity_types_service_name_normalized ON commodity_types USING btree (service_type_id, lower(btrim(name)))',
      },
    ],
    invalidRows: [],
    duplicateKeys: [],
    groupSnapshot: {
      schema_checksum: 'legacy-schema',
      row_count: 6,
      row_checksum: 'legacy-data',
    },
    ledger: null,
    ledgerChecksumMatches: true,
    ...overrides,
  };
}

function columnFixture(name, dataType, length = null) {
  return {
    column_name: name,
    data_type: dataType,
    is_nullable: 'NO',
    character_maximum_length: length,
    column_default:
      name === 'id'
        ? "nextval('commodity_types_id_seq'::regclass)"
        : name === 'created_at' || name === 'updated_at'
          ? 'now()'
          : null,
    is_identity: 'NO',
  };
}

function constraintFixture(name, type, definition) {
  return { conname: name, contype: type, convalidated: true, definition };
}

function buildClientConfig() {
  const explicitSsl = process.env.DB_SSL?.trim().toLowerCase();
  const ssl = ['true', '1', 'require', 'verify-ca', 'verify-full'].includes(
    explicitSsl ?? '',
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

function verifyApplyGuards(args, config) {
  if (!args.apply) return null;
  if (!args.targetDb || args.targetDb !== config.database) {
    throw new Error(
      '--target-db must exactly match the configured database name',
    );
  }
  if (!args.backupReference?.trim()) {
    throw new Error('--backup-reference is required for --apply');
  }
  if (args.confirmation !== CONFIRMATION) {
    throw new Error(`--confirm must equal ${CONFIRMATION}`);
  }
  if (!args.logicalExport || !isAbsolute(args.logicalExport)) {
    throw new Error('--logical-export must be an absolute existing file');
  }
  const path = realpathSync(args.logicalExport);
  const stats = statSync(path);
  const projectRelative = relative(PROJECT_ROOT, path);
  if (!stats.isFile() || stats.size === 0) {
    throw new Error('--logical-export must be a non-empty file');
  }
  if (
    projectRelative === '' ||
    (!projectRelative.startsWith('..') && !isAbsolute(projectRelative))
  ) {
    throw new Error('--logical-export must be stored outside backend2.0');
  }
  return { path, size: stats.size };
}

async function inspectSchema(client, expectedChecksum) {
  const relations = await client.query(`
    SELECT
      to_regclass('public.service_types') IS NOT NULL AS service_types_exists,
      to_regclass('public.commodity_types') IS NOT NULL AS commodity_types_exists,
      to_regclass('public.commodity_groups') IS NOT NULL AS commodity_groups_exists,
      to_regclass('public.commodity_type_assignments') IS NOT NULL AS assignments_exists
  `);
  const state = relations.rows[0];
  const columns = state.commodity_types_exists
    ? (
        await client.query(`
          SELECT column_name, data_type, is_nullable, character_maximum_length,
                 column_default, is_identity
            FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'commodity_types'
           ORDER BY ordinal_position
        `)
      ).rows
    : [];
  const constraints = state.commodity_types_exists
    ? (
        await client.query(`
          SELECT conname, contype, convalidated,
                 pg_get_constraintdef(oid) AS definition
            FROM pg_constraint
           WHERE conrelid = 'public.commodity_types'::regclass
           ORDER BY conname
        `)
      ).rows
    : [];
  const indexes = state.commodity_types_exists
    ? (
        await client.query(`
          SELECT indexname, indexdef
            FROM pg_indexes
           WHERE schemaname = 'public' AND tablename = 'commodity_types'
           ORDER BY indexname
        `)
      ).rows
    : [];
  const invalidRows = state.commodity_types_exists
    ? (
        await client.query(`
          SELECT id, service_type_id, code, name
            FROM commodity_types
           WHERE btrim(code) = '' OR btrim(name) = ''
           ORDER BY id LIMIT 100
        `)
      ).rows
    : [];
  const duplicateKeys = state.commodity_types_exists
    ? (
        await client.query(`
          SELECT service_type_id, 'code' AS key, lower(btrim(code)) AS value
            FROM commodity_types
           GROUP BY service_type_id, lower(btrim(code)) HAVING count(*) > 1
          UNION ALL
          SELECT service_type_id, 'name' AS key, lower(btrim(name)) AS value
            FROM commodity_types
           GROUP BY service_type_id, lower(btrim(name)) HAVING count(*) > 1
           ORDER BY service_type_id, key, value
        `)
      ).rows
    : [];
  const prohibitedCommodityFk =
    (
      await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'commodities'
           AND column_name = 'commodity_type_id'
      ) AS exists
    `)
    ).rows[0]?.exists === true;
  const groupSnapshot = state.commodity_groups_exists
    ? (
        await client.query(`
          SELECT
            (SELECT md5(coalesce(string_agg(
              column_name || ':' || data_type || ':' || is_nullable,
              '|' ORDER BY ordinal_position), ''))
               FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'commodity_groups')
              AS schema_checksum,
            count(*)::integer AS row_count,
            md5(coalesce(string_agg(row_to_json(cg)::text, '|' ORDER BY id), ''))
              AS row_checksum
          FROM commodity_groups cg
        `)
      ).rows[0]
    : null;
  const ledgerTable =
    (
      await client.query(
        `SELECT to_regclass('public.app_schema_migrations') IS NOT NULL AS exists`,
      )
    ).rows[0]?.exists === true;
  const ledger = ledgerTable
    ? ((
        await client.query(
          `SELECT migration_id, script_checksum, status
             FROM app_schema_migrations WHERE migration_id = $1`,
          [MIGRATION_ID],
        )
      ).rows[0] ?? null)
    : null;
  return {
    serviceTypesExists: state.service_types_exists === true,
    commodityTypesExists: state.commodity_types_exists === true,
    commodityGroupsExists: state.commodity_groups_exists === true,
    assignmentsExists: state.assignments_exists === true,
    prohibitedCommodityFk,
    columns,
    constraints,
    indexes,
    invalidRows,
    duplicateKeys,
    groupSnapshot,
    ledger,
    ledgerChecksumMatches:
      ledger == null || ledger.script_checksum === expectedChecksum,
  };
}

function validatePreflight(report) {
  const expectedColumns = new Map([
    ['id', ['integer', 'NO', null]],
    ['service_type_id', ['integer', 'NO', null]],
    ['code', ['character varying', 'NO', 100]],
    ['name', ['character varying', 'NO', 200]],
    ['created_at', ['timestamp with time zone', 'NO', null]],
    ['updated_at', ['timestamp with time zone', 'NO', null]],
  ]);
  const actualColumns = new Map(
    report.columns.map((column) => [column.column_name, column]),
  );
  const incompatibleColumns = report.commodityTypesExists
    ? [...expectedColumns].flatMap(([name, expected]) => {
        const actual = actualColumns.get(name);
        return !actual ||
          actual.data_type !== expected[0] ||
          actual.is_nullable !== expected[1] ||
          actual.character_maximum_length !== expected[2]
          ? [name]
          : [];
      })
    : [];
  const unexpectedColumns = report.commodityTypesExists
    ? [...actualColumns.keys()].filter((name) => !expectedColumns.has(name))
    : [];
  const incompatibleDefaults = report.commodityTypesExists
    ? [
        isGeneratedId(actualColumns.get('id')) ? null : 'id',
        hasTimestampDefault(actualColumns.get('created_at'))
          ? null
          : 'created_at',
        hasTimestampDefault(actualColumns.get('updated_at'))
          ? null
          : 'updated_at',
      ].filter(Boolean)
    : [];
  const blockers = {
    missingServiceTypes: report.serviceTypesExists ? [] : ['service_types'],
    incompatibleColumns,
    unexpectedColumns,
    incompatibleDefaults,
    invalidRows: report.invalidRows,
    duplicateKeys: report.duplicateKeys,
    assignmentTable: report.assignmentsExists
      ? ['commodity_type_assignments']
      : [],
    commodityTypeFk: report.prohibitedCommodityFk
      ? ['commodities.commodity_type_id']
      : [],
    ledgerChecksum: report.ledgerChecksumMatches ? [] : [MIGRATION_ID],
  };
  if (Object.values(blockers).some((items) => items.length > 0)) {
    throw new Error(
      `Commodity Type preflight blockers: ${JSON.stringify(blockers)}`,
    );
  }
}

function isGeneratedId(column) {
  return (
    column?.is_identity === 'YES' ||
    /nextval\s*\(/i.test(column?.column_default ?? '')
  );
}

function hasTimestampDefault(column) {
  return /\b(?:now\s*\(|current_timestamp\b)/i.test(
    column?.column_default ?? '',
  );
}

export function hasNonblankCheck(definitions, column) {
  const normalized = String(definitions ?? '')
    .toLowerCase()
    .replace(/::(?:character varying|text)/g, '')
    .replace(/["()\s]/g, '');
  return normalized.includes(`checkbtrim${column}<>''`);
}

function validatePostflight(before, after) {
  validatePreflight(after);
  if (!after.commodityTypesExists) {
    throw new Error('Postflight: commodity_types was not created');
  }
  const validConstraints = after.constraints.filter(
    (constraint) => constraint.convalidated === true,
  );
  const constraintDefs = validConstraints
    .map((item) => item.definition)
    .join('\n');
  if (!/PRIMARY KEY \(id\)/i.test(constraintDefs)) {
    throw new Error('Postflight: commodity_types primary key is missing');
  }
  if (
    !/FOREIGN KEY \(service_type_id\).*service_types\(id\).*ON DELETE RESTRICT/i.test(
      constraintDefs,
    )
  ) {
    throw new Error('Postflight: Service FK is missing or incompatible');
  }
  if (!hasNonblankCheck(constraintDefs, 'code')) {
    throw new Error('Postflight: nonblank code constraint is missing');
  }
  if (!hasNonblankCheck(constraintDefs, 'name')) {
    throw new Error('Postflight: nonblank name constraint is missing');
  }
  const codeIndex = after.indexes.find(
    (item) => item.indexname === 'uq_commodity_types_service_code_normalized',
  );
  const nameIndex = after.indexes.find(
    (item) => item.indexname === 'uq_commodity_types_service_name_normalized',
  );
  if (!isNormalizedUniqueIndex(codeIndex?.indexdef, 'code')) {
    throw new Error('Postflight: normalized unique code index is missing');
  }
  if (!isNormalizedUniqueIndex(nameIndex?.indexdef, 'name')) {
    throw new Error('Postflight: normalized unique indexes are missing');
  }
  if (
    JSON.stringify(before.groupSnapshot) !== JSON.stringify(after.groupSnapshot)
  ) {
    throw new Error(
      'Postflight: commodity_groups changed during expand migration',
    );
  }
}

export function isNormalizedUniqueIndex(definition, column) {
  const normalized = String(definition ?? '')
    .toLowerCase()
    .replace(/::(?:character varying|text)/g, '')
    .replace(/["()\s]/g, '');
  return (
    normalized.startsWith('createuniqueindex') &&
    normalized.includes('service_type_id,lowerbtrim' + column)
  );
}

async function inspectReadOnly(client, checksum) {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    await client.query(`SET LOCAL statement_timeout = '30s'`);
    const report = await inspectSchema(client, checksum);
    await client.query('ROLLBACK');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      migration_id VARCHAR(160) PRIMARY KEY,
      script_checksum CHAR(64) NOT NULL,
      status VARCHAR(16) NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
      backup_reference TEXT,
      logical_export_reference TEXT,
      details JSONB,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);
}

async function inspectCommodityTypeBackfill(client) {
  // A pg Client owns one socket; keep inspection queries sequential.
  const serviceTypes = await client.query(
    `SELECT id, name, display_name AS "displayName" FROM service_types ORDER BY id`,
  );
  const groups = await client.query(
    `SELECT id, service_type_id AS "serviceTypeId", name FROM commodity_groups ORDER BY service_type_id, id`,
  );
  const cargoTypes = await client.query(
    `SELECT code, service_type_type AS "serviceTypeType", display_label AS "displayLabel" FROM cargo_types ORDER BY service_type_type, code`,
  );
  const catalogTypes = await client.query(
    `SELECT id, service_type_id AS "serviceTypeId", code, name FROM commodity_types ORDER BY service_type_id, id`,
  );
  const groupSnapshot = await client.query(
    `SELECT count(*)::integer AS "rowCount", md5(coalesce(string_agg(row_to_json(cg)::text, '|' ORDER BY id), '')) AS checksum FROM commodity_groups cg`,
  );
  const commoditySnapshot = await client.query(
    `SELECT count(*)::integer AS "rowCount", md5(coalesce(string_agg(row_to_json(c)::text, '|' ORDER BY id), '')) AS checksum FROM commodities c`,
  );
  return summarizeCommodityTypeBackfill({
    serviceTypes: serviceTypes.rows,
    groups: groups.rows,
    cargoTypes: cargoTypes.rows,
    catalogTypes: catalogTypes.rows,
    groupSnapshot: groupSnapshot.rows[0],
    commoditySnapshot: commoditySnapshot.rows[0],
  });
}

async function inspectCommodityTypeBackfillReadOnly(client) {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    await client.query(`SET LOCAL statement_timeout = '30s'`);
    const summary = await inspectCommodityTypeBackfill(client);
    await client.query('ROLLBACK');
    return summary;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function verifyDataApplyGuards(args, config) {
  if (!args.apply) return null;
  if (args.confirmation !== DATA_CONFIRMATION) {
    throw new Error(`--confirm must equal ${DATA_CONFIRMATION}`);
  }
  return verifyApplyGuards({ ...args, confirmation: CONFIRMATION }, config);
}

async function runCommodityTypeDataMigration(args) {
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  loadEnvFile(join(PROJECT_ROOT, '.env.local'));
  const config = buildClientConfig();
  const sql = readFileSync(DATA_SQL_PATH, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const logicalExport = verifyDataApplyGuards(args, config);
  const rollForwardRecovery = {
    strategy:
      'Fix the reported source/catalog conflict, then rerun the same --phase=data command.',
    safety:
      'The failed transaction is rolled back; ON CONFLICT DO NOTHING makes a successful rerun idempotent.',
    prohibition:
      'Do not delete catalog rows or rewrite commodities/commodity_groups to recover.',
  };
  const client = new pg.Client(config);
  await client.connect();
  let lockAcquired = false;
  try {
    const before = await inspectCommodityTypeBackfillReadOnly(client);
    validateCommodityTypeBackfillPreflight(before);
    console.log(
      JSON.stringify(
        {
          mode: args.apply ? 'apply' : 'dry-run',
          phase: 'data',
          migrationId: DATA_MIGRATION_ID,
          scriptChecksum: checksum,
          preflight: before,
          rollForwardRecovery,
        },
        null,
        2,
      ),
    );
    if (!args.apply) {
      console.log(
        'Dry-run only. The inspection used a READ ONLY transaction; no writes occurred.',
      );
      return;
    }

    const lock = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [DATA_LOCK_NAME],
    );
    lockAcquired = lock.rows[0]?.acquired === true;
    if (!lockAcquired) {
      throw new Error('Another Commodity Type data migration is running');
    }
    await ensureLedger(client);
    const ledger = await client.query(
      `SELECT script_checksum, status FROM app_schema_migrations WHERE migration_id = $1`,
      [DATA_MIGRATION_ID],
    );
    const existing = ledger.rows[0];
    if (existing && existing.script_checksum !== checksum) {
      throw new Error('Data migration ID exists with a different checksum');
    }
    if (existing?.status === 'SUCCEEDED') {
      if (before.missingCandidates.length > 0) {
        throw new Error(
          'Data ledger says SUCCEEDED but source coverage is incomplete',
        );
      }
      console.log('Commodity Type data migration already succeeded.');
      return;
    }
    await client.query(
      `INSERT INTO app_schema_migrations (
         migration_id, script_checksum, status, backup_reference,
         logical_export_reference, started_at, completed_at, details
       ) VALUES ($1, $2, 'RUNNING', $3, $4, NOW(), NULL, $5::jsonb)
       ON CONFLICT (migration_id) DO UPDATE SET
         status = 'RUNNING', backup_reference = EXCLUDED.backup_reference,
         logical_export_reference = EXCLUDED.logical_export_reference,
         started_at = NOW(), completed_at = NULL, details = EXCLUDED.details`,
      [
        DATA_MIGRATION_ID,
        checksum,
        args.backupReference,
        logicalExport.path,
        JSON.stringify({ before, rollForwardRecovery }),
      ],
    );
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '5s'`);
      await client.query(`SET LOCAL statement_timeout = '5min'`);
      await client.query(sql);
      const after = await inspectCommodityTypeBackfill(client);
      validateCommodityTypeBackfillPostflight(before, after);
      await client.query('COMMIT');
      await client.query(
        `UPDATE app_schema_migrations SET status = 'SUCCEEDED', completed_at = NOW(),
          details = $2::jsonb WHERE migration_id = $1`,
        [
          DATA_MIGRATION_ID,
          JSON.stringify({ before, after, rollForwardRecovery }),
        ],
      );
      console.log(
        JSON.stringify({ committed: true, postflight: after }, null, 2),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      await client.query(
        `UPDATE app_schema_migrations SET status = 'FAILED', completed_at = NOW(),
          details = coalesce(details, '{}'::jsonb)
            || jsonb_build_object('error', $2::text, 'rollForwardRecovery', $3::jsonb)
          WHERE migration_id = $1`,
        [
          DATA_MIGRATION_ID,
          error instanceof Error ? error.message : String(error),
          JSON.stringify(rollForwardRecovery),
        ],
      );
      throw error;
    }
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
        DATA_LOCK_NAME,
      ]);
    }
    await client.end();
  }
}

async function inspectGalleryTypeExpand(client) {
  const relations = await client.query(`
    SELECT
      to_regclass('public.gallery_images') IS NOT NULL AS gallery_exists,
      to_regclass('public.commodity_types') IS NOT NULL AS types_exists,
      to_regclass('public.commodity_type_assignments') IS NOT NULL AS assignments_exists
  `);
  const state = relations.rows[0];
  const column = state.gallery_exists
    ? ((
        await client.query(`
          SELECT data_type, is_nullable
            FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'gallery_images'
             AND column_name = 'commodity_type_id'
        `)
      ).rows[0] ?? null)
    : null;
  const constraints = state.gallery_exists
    ? (
        await client.query(`
          SELECT conname, contype, convalidated, confdeltype,
                 pg_get_constraintdef(oid) AS definition
            FROM pg_constraint
           WHERE conrelid = 'public.gallery_images'::regclass
           ORDER BY conname
        `)
      ).rows
    : [];
  const indexes = state.gallery_exists
    ? (
        await client.query(`
          SELECT indexname, indexdef FROM pg_indexes
           WHERE schemaname = 'public' AND tablename = 'gallery_images'
           ORDER BY indexname
        `)
      ).rows
    : [];
  const snapshot = state.gallery_exists
    ? (
        await client.query(`
          SELECT count(*)::integer AS row_count,
                 md5(coalesce(string_agg(
                   (to_jsonb(gi) - 'commodity_type_id')::text,
                   '|' ORDER BY id
                 ), '')) AS row_checksum
            FROM gallery_images gi
        `)
      ).rows[0]
    : { row_count: 0, row_checksum: null };
  const expectedFk = constraints.find(
    (item) =>
      item.contype === 'f' &&
      /FOREIGN KEY \(commodity_type_id\).*REFERENCES commodity_types\(id\)/i.test(
        item.definition,
      ),
  );
  const expectedIndex = indexes.find((item) =>
    /\(commodity_type_id\)/i.test(item.indexdef),
  );
  const namedFk = constraints.find(
    (item) => item.conname === 'fk_gallery_images_commodity_type',
  );
  const namedIndex = indexes.find(
    (item) => item.indexname === 'idx_gallery_images_commodity_type_id',
  );
  const compositeConstraintExists = [...constraints, ...indexes].some(
    (item) => {
      const definition = item.definition ?? item.indexdef ?? '';
      return (
        /commodity_id/i.test(definition) &&
        /commodity_type_id/i.test(definition)
      );
    },
  );
  return {
    galleryTableExists: state.gallery_exists === true,
    commodityTypesTableExists: state.types_exists === true,
    columnExists: column != null,
    columnNullable: column?.is_nullable === 'YES',
    columnType: column?.data_type ?? null,
    fkExists: expectedFk != null,
    fkValid: expectedFk?.convalidated === true,
    fkDeleteAction: expectedFk?.confdeltype ?? null,
    indexExists: expectedIndex != null,
    assignmentTableExists: state.assignments_exists === true,
    compositeConstraintExists,
    fkNameConflict:
      namedFk && namedFk !== expectedFk ? namedFk.definition : null,
    indexNameConflict:
      namedIndex && namedIndex !== expectedIndex ? namedIndex.indexdef : null,
    rowCount: snapshot.row_count,
    rowChecksum: snapshot.row_checksum,
  };
}

async function inspectGalleryTypeExpandReadOnly(client) {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    await client.query(`SET LOCAL statement_timeout = '30s'`);
    const report = await inspectGalleryTypeExpand(client);
    await client.query('ROLLBACK');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function runGalleryTypeExpandMigration(args) {
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  loadEnvFile(join(PROJECT_ROOT, '.env.local'));
  const config = buildClientConfig();
  const sql = readFileSync(GALLERY_SQL_PATH, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  if (args.apply && args.confirmation !== GALLERY_CONFIRMATION) {
    throw new Error(`--confirm must equal ${GALLERY_CONFIRMATION}`);
  }
  const logicalExport = verifyApplyGuards(
    args.apply ? { ...args, confirmation: CONFIRMATION } : args,
    config,
  );
  const client = new pg.Client(config);
  await client.connect();
  let lockAcquired = false;
  try {
    const before = await inspectGalleryTypeExpandReadOnly(client);
    validateGalleryTypeExpandPreflight(before);
    console.log(
      JSON.stringify(
        {
          mode: args.apply ? 'apply' : 'dry-run',
          phase: 'gallery-expand',
          migrationId: GALLERY_MIGRATION_ID,
          scriptChecksum: checksum,
          preflight: before,
          migrationOrder: [
            'commodity-types-expand',
            'commodity-types-data',
            'gallery-expand',
          ],
        },
        null,
        2,
      ),
    );
    if (!args.apply) {
      console.log(
        'Dry-run only. READ ONLY preflight completed; no writes occurred.',
      );
      return;
    }
    const lock = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [GALLERY_LOCK_NAME],
    );
    lockAcquired = lock.rows[0]?.acquired === true;
    if (!lockAcquired)
      throw new Error('Another Gallery Type expand is running');
    await ensureLedger(client);
    const ledger = await client.query(
      `SELECT script_checksum, status FROM app_schema_migrations WHERE migration_id = $1`,
      [GALLERY_MIGRATION_ID],
    );
    const existing = ledger.rows[0];
    if (existing && existing.script_checksum !== checksum) {
      throw new Error('Gallery migration ID exists with a different checksum');
    }
    if (existing?.status === 'SUCCEEDED') {
      validateGalleryTypeExpandPostflight(before, before);
      console.log('Gallery Type expand already succeeded.');
      return;
    }
    await client.query(
      `INSERT INTO app_schema_migrations (
         migration_id, script_checksum, status, backup_reference,
         logical_export_reference, started_at, completed_at, details
       ) VALUES ($1, $2, 'RUNNING', $3, $4, NOW(), NULL, $5::jsonb)
       ON CONFLICT (migration_id) DO UPDATE SET
         status = 'RUNNING', backup_reference = EXCLUDED.backup_reference,
         logical_export_reference = EXCLUDED.logical_export_reference,
         started_at = NOW(), completed_at = NULL, details = EXCLUDED.details`,
      [
        GALLERY_MIGRATION_ID,
        checksum,
        args.backupReference,
        logicalExport.path,
        JSON.stringify({ before }),
      ],
    );
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '5s'`);
      await client.query(`SET LOCAL statement_timeout = '5min'`);
      await client.query(sql);
      const after = await inspectGalleryTypeExpand(client);
      validateGalleryTypeExpandPostflight(before, after);
      await client.query('COMMIT');
      await client.query(
        `UPDATE app_schema_migrations SET status = 'SUCCEEDED', completed_at = NOW(),
          details = $2::jsonb WHERE migration_id = $1`,
        [GALLERY_MIGRATION_ID, JSON.stringify({ before, after })],
      );
      console.log(
        JSON.stringify({ committed: true, postflight: after }, null, 2),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      await client.query(
        `UPDATE app_schema_migrations SET status = 'FAILED', completed_at = NOW(),
          details = coalesce(details, '{}'::jsonb) || jsonb_build_object('error', $2::text)
          WHERE migration_id = $1`,
        [
          GALLERY_MIGRATION_ID,
          error instanceof Error ? error.message : String(error),
        ],
      );
      throw error;
    }
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
        GALLERY_LOCK_NAME,
      ]);
    }
    await client.end();
  }
}

async function inspectInquiryIdsExpand(client) {
  const relations = await client.query(`
    SELECT
      to_regclass('public.shipping_agency_inquiries') IS NOT NULL AS inquiry_exists,
      to_regclass('public.commodity_types') IS NOT NULL AS types_exists,
      to_regclass('public.commodities') IS NOT NULL AS commodities_exists
  `);
  const state = relations.rows[0];
  const columns = state.inquiry_exists
    ? (
        await client.query(`
          SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'shipping_agency_inquiries'
             AND column_name IN ('commodity_type_id', 'commodity_id')
           ORDER BY column_name
        `)
      ).rows
    : [];
  const constraints = state.inquiry_exists
    ? (
        await client.query(`
          SELECT conname, contype, convalidated, confdeltype,
                 pg_get_constraintdef(oid) AS definition
            FROM pg_constraint
           WHERE conrelid = 'public.shipping_agency_inquiries'::regclass
           ORDER BY conname
        `)
      ).rows
    : [];
  const indexes = state.inquiry_exists
    ? (
        await client.query(`
          SELECT indexname, indexdef FROM pg_indexes
           WHERE schemaname = 'public' AND tablename = 'shipping_agency_inquiries'
           ORDER BY indexname
        `)
      ).rows
    : [];
  const snapshot = state.inquiry_exists
    ? columns.length === 2
      ? (
          await client.query(`
          SELECT count(*)::integer AS row_count,
                 count(*) FILTER (WHERE commodity_type_id IS NULL)::integer AS null_type_count,
                 count(*) FILTER (WHERE commodity_id IS NULL)::integer AS null_commodity_count,
                 md5(coalesce(string_agg(
                   (to_jsonb(i) - 'commodity_type_id' - 'commodity_id')::text,
                   '|' ORDER BY id
                 ), '')) AS row_checksum
            FROM shipping_agency_inquiries i
        `)
        ).rows[0]
      : (
          await client.query(`
          SELECT count(*)::integer AS row_count,
                 count(*)::integer AS null_type_count,
                 count(*)::integer AS null_commodity_count,
                 md5(coalesce(string_agg(to_jsonb(i)::text, '|' ORDER BY id), '')) AS row_checksum
            FROM shipping_agency_inquiries i
        `)
        ).rows[0]
    : {
        row_count: 0,
        null_type_count: 0,
        null_commodity_count: 0,
        row_checksum: null,
      };
  const typeFk = constraints.find(
    (item) =>
      item.contype === 'f' &&
      /FOREIGN KEY \(commodity_type_id\).*REFERENCES commodity_types\(id\)/i.test(
        item.definition,
      ),
  );
  const commodityFk = constraints.find(
    (item) =>
      item.contype === 'f' &&
      /FOREIGN KEY \(commodity_id\).*REFERENCES commodities\(id\)/i.test(
        item.definition,
      ),
  );
  const typeIndex = indexes.find((item) =>
    /\(commodity_type_id\)/i.test(item.indexdef),
  );
  const commodityIndex = indexes.find((item) =>
    /\(commodity_id\)/i.test(item.indexdef),
  );
  const linkedConstraintExists = [...constraints, ...indexes].some((item) => {
    const definition = item.definition ?? item.indexdef ?? '';
    return (
      /commodity_type_id/i.test(definition) && /commodity_id/i.test(definition)
    );
  });
  return {
    inquiryTableExists: state.inquiry_exists === true,
    commodityTypesTableExists: state.types_exists === true,
    commoditiesTableExists: state.commodities_exists === true,
    columnsExist: columns.length === 2,
    partialColumns: columns.length === 1,
    idsNullable:
      columns.length === 2 &&
      columns.every(
        (column) =>
          column.data_type === 'integer' && column.is_nullable === 'YES',
      ),
    typeFkExists: typeFk != null,
    commodityFkExists: commodityFk != null,
    typeFkValid: typeFk?.convalidated === true,
    commodityFkValid: commodityFk?.convalidated === true,
    typeFkDeleteAction: typeFk?.confdeltype ?? null,
    commodityFkDeleteAction: commodityFk?.confdeltype ?? null,
    typeIndexExists: typeIndex != null,
    commodityIndexExists: commodityIndex != null,
    linkedConstraintExists,
    rowCount: snapshot.row_count,
    nullTypeCount: snapshot.null_type_count,
    nullCommodityCount: snapshot.null_commodity_count,
    rowChecksum: snapshot.row_checksum,
  };
}

async function inspectInquiryIdsExpandReadOnly(client) {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    await client.query(`SET LOCAL statement_timeout = '30s'`);
    const report = await inspectInquiryIdsExpand(client);
    await client.query('ROLLBACK');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function runInquiryIdsExpandMigration(args) {
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  loadEnvFile(join(PROJECT_ROOT, '.env.local'));
  const config = buildClientConfig();
  const sql = readFileSync(INQUIRY_SQL_PATH, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  if (args.apply && args.confirmation !== INQUIRY_CONFIRMATION) {
    throw new Error(`--confirm must equal ${INQUIRY_CONFIRMATION}`);
  }
  const logicalExport = verifyApplyGuards(
    args.apply ? { ...args, confirmation: CONFIRMATION } : args,
    config,
  );
  const client = new pg.Client(config);
  await client.connect();
  let lockAcquired = false;
  try {
    const before = await inspectInquiryIdsExpandReadOnly(client);
    validateInquiryIdsExpandPreflight(before);
    console.log(
      JSON.stringify(
        {
          mode: args.apply ? 'apply' : 'dry-run',
          phase: 'inquiry-expand',
          migrationId: INQUIRY_MIGRATION_ID,
          scriptChecksum: checksum,
          preflight: before,
          migrationOrder: [
            'commodity-types-expand',
            'commodity-types-data',
            'independent-commodities',
            'inquiry-expand',
          ],
        },
        null,
        2,
      ),
    );
    if (!args.apply) {
      console.log(
        'Dry-run only. READ ONLY preflight completed; no writes occurred.',
      );
      return;
    }
    const lock = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [INQUIRY_LOCK_NAME],
    );
    lockAcquired = lock.rows[0]?.acquired === true;
    if (!lockAcquired) throw new Error('Another inquiry ID expand is running');
    await ensureLedger(client);
    const ledger = await client.query(
      `SELECT script_checksum, status FROM app_schema_migrations WHERE migration_id = $1`,
      [INQUIRY_MIGRATION_ID],
    );
    const existing = ledger.rows[0];
    if (existing && existing.script_checksum !== checksum) {
      throw new Error('Inquiry migration ID exists with a different checksum');
    }
    if (existing?.status === 'SUCCEEDED') {
      validateInquiryIdsExpandPostflight(before, before);
      console.log('Inquiry ID expand already succeeded.');
      return;
    }
    await client.query(
      `INSERT INTO app_schema_migrations (
         migration_id, script_checksum, status, backup_reference,
         logical_export_reference, started_at, completed_at, details
       ) VALUES ($1, $2, 'RUNNING', $3, $4, NOW(), NULL, $5::jsonb)
       ON CONFLICT (migration_id) DO UPDATE SET
         status = 'RUNNING', backup_reference = EXCLUDED.backup_reference,
         logical_export_reference = EXCLUDED.logical_export_reference,
         started_at = NOW(), completed_at = NULL, details = EXCLUDED.details`,
      [
        INQUIRY_MIGRATION_ID,
        checksum,
        args.backupReference,
        logicalExport.path,
        JSON.stringify({ before }),
      ],
    );
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '5s'`);
      await client.query(sql);
      const after = await inspectInquiryIdsExpand(client);
      validateInquiryIdsExpandPostflight(before, after);
      await client.query('COMMIT');
      await client.query(
        `UPDATE app_schema_migrations SET status = 'SUCCEEDED', completed_at = NOW(),
          details = $2::jsonb WHERE migration_id = $1`,
        [INQUIRY_MIGRATION_ID, JSON.stringify({ before, after })],
      );
      console.log(
        JSON.stringify({ committed: true, postflight: after }, null, 2),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      await client.query(
        `UPDATE app_schema_migrations SET status = 'FAILED', completed_at = NOW(),
          details = coalesce(details, '{}'::jsonb) || jsonb_build_object('error', $2::text)
          WHERE migration_id = $1`,
        [
          INQUIRY_MIGRATION_ID,
          error instanceof Error ? error.message : String(error),
        ],
      );
      throw error;
    }
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
        INQUIRY_LOCK_NAME,
      ]);
    }
    await client.end();
  }
}

async function inspectIndependentCommodityDataReadOnly(client) {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    await client.query(`SET LOCAL statement_timeout = '30s'`);
    const snapshot = await collectIndependentCommodityRecoverySnapshot(client);
    await client.query('ROLLBACK');
    return snapshot;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function runIndependentCommodityDataMigration(args) {
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  loadEnvFile(join(PROJECT_ROOT, '.env.local'));
  const config = buildClientConfig();
  const sql = readFileSync(DUPLICATE_DATA_SQL_PATH, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const recoveryTarget = verifyDuplicateDataApplyGuards(args, config);
  const client = new pg.Client(config);
  await client.connect();
  let lockAcquired = false;
  try {
    const dryRunSnapshot =
      await inspectIndependentCommodityDataReadOnly(client);
    const dryRunPlan = buildIndependentCommodityMergePlan(dryRunSnapshot);
    const dryRunBefore = summarizeIndependentCommodityState(dryRunSnapshot);
    validateIndependentCommodityDataPreflight(dryRunBefore, dryRunPlan);
    console.log(
      JSON.stringify(
        {
          mode: args.apply ? 'apply' : 'dry-run',
          phase: 'duplicate-data',
          migrationId: DUPLICATE_DATA_MIGRATION_ID,
          scriptChecksum: checksum,
          preflight: dryRunBefore,
          proposedMergeMap: dryRunPlan.mergeMap,
          migrationOrder: [
            'commodity-types-expand',
            'commodity-types-data',
            'inquiry-expand',
            'duplicate-data',
          ],
        },
        null,
        2,
      ),
    );
    if (!args.apply) {
      console.log(
        'Dry-run only. READ ONLY preflight completed; no export or writes occurred.',
      );
      return;
    }

    const lock = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [DUPLICATE_DATA_LOCK_NAME],
    );
    lockAcquired = lock.rows[0]?.acquired === true;
    if (!lockAcquired) {
      throw new Error(
        'Another independent Commodity data migration is running',
      );
    }

    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL lock_timeout = '5s'`);
      await client.query(`SET LOCAL statement_timeout = '5min'`);
      await client.query(
        `LOCK TABLE public.commodities, public.gallery_images,
          public.booking_records, public.arrival_notice_records,
          public.delivery_order_records, public.bill_of_lading_records
          IN SHARE ROW EXCLUSIVE MODE`,
      );
      const inquiryColumn = (
        await client.query(`SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'shipping_agency_inquiries'
            AND column_name = 'commodity_id'
        ) AS exists`)
      ).rows[0]?.exists;
      if (inquiryColumn) {
        await client.query(
          'LOCK TABLE public.shipping_agency_inquiries IN SHARE ROW EXCLUSIVE MODE',
        );
      }

      const snapshot =
        await collectIndependentCommodityRecoverySnapshot(client);
      const plan = buildIndependentCommodityMergePlan(snapshot);
      const before = summarizeIndependentCommodityState(snapshot);
      validateIndependentCommodityDataPreflight(before, plan);
      const simulatedAfterSnapshot = applyIndependentCommodityMergeFixture(
        snapshot,
        plan,
      );
      const simulatedAfter = summarizeIndependentCommodityState(
        simulatedAfterSnapshot,
      );
      validateIndependentCommodityDataPostflight(before, simulatedAfter, plan);
      const envelope = createIndependentCommodityRecoveryEnvelope(snapshot, {
        backupReference: recoveryTarget.backupReference,
        restoreTested: true,
        rollForwardTested: true,
        restoreTestReference: recoveryTarget.restoreTestReference,
        rollForwardTestReference: recoveryTarget.rollForwardTestReference,
      });
      const verifiedExport = writeIndependentCommodityRecoveryExport(
        recoveryTarget.path,
        envelope,
      );
      if (verifiedExport.checksum !== envelope.checksum) {
        throw new Error('Recovery export verification failed before apply');
      }

      await ensureLedger(client);
      await client.query(
        `INSERT INTO app_schema_migrations (
           migration_id, script_checksum, status, backup_reference,
           logical_export_reference, started_at, completed_at, details
         ) VALUES ($1, $2, 'RUNNING', $3, $4, NOW(), NULL, $5::jsonb)
         ON CONFLICT (migration_id) DO UPDATE SET
           status = 'RUNNING', script_checksum = EXCLUDED.script_checksum,
           backup_reference = EXCLUDED.backup_reference,
           logical_export_reference = EXCLUDED.logical_export_reference,
           started_at = NOW(), completed_at = NULL, details = EXCLUDED.details`,
        [
          DUPLICATE_DATA_MIGRATION_ID,
          checksum,
          recoveryTarget.backupReference,
          recoveryTarget.path,
          JSON.stringify({
            before,
            plan: plan.mergeMap,
            recovery: envelope.evidence,
          }),
        ],
      );
      await client.query(sql);
      const afterSnapshot =
        await collectIndependentCommodityRecoverySnapshot(client);
      const after = summarizeIndependentCommodityState(afterSnapshot);
      validateIndependentCommodityDataPostflight(before, after, plan);
      await client.query(
        `UPDATE app_schema_migrations SET status = 'SUCCEEDED', completed_at = NOW(),
          details = $2::jsonb WHERE migration_id = $1`,
        [
          DUPLICATE_DATA_MIGRATION_ID,
          JSON.stringify({ before, after, recovery: envelope.evidence }),
        ],
      );
      await client.query('COMMIT');
      console.log(
        JSON.stringify(
          {
            committed: true,
            postflight: after,
            recoveryExport: {
              path: recoveryTarget.path,
              checksum: envelope.checksum,
              restoreAndRollForwardEvidence: envelope.evidence,
            },
          },
          null,
          2,
        ),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
        DUPLICATE_DATA_LOCK_NAME,
      ]);
    }
    await client.end();
  }
}

function contractExecutableSql(sql) {
  return sql.replace(/--.*$/gm, '');
}

export function verifyCommodityContractStatic(sql) {
  const executable = contractExecutableSql(sql);
  assert.match(
    executable,
    /ALTER TABLE public\.commodities[\s\S]*DROP COLUMN group_id[\s\S]*DROP COLUMN required_image_count[\s\S]*DROP COLUMN cargo_type\s*;/i,
  );
  assert.match(executable, /DROP TABLE public\.commodity_groups\s*;/i);
  assert.match(
    executable,
    /CREATE UNIQUE INDEX uq_commodities_service_name_normalized/i,
  );
  assert.doesNotMatch(executable, /\bCASCADE\b/i);
  assert.doesNotMatch(executable, /\b(?:UPDATE|INSERT|DELETE|TRUNCATE)\b/i);
  assert.doesNotMatch(executable, /\b(?:cargo_types|package_types)\b/i);
  assert.equal(
    (executable.match(/\bDROP\s+(?:COLUMN|TABLE)\b/gi) ?? []).length,
    4,
  );
  return {
    sqlChecksum: createHash('sha256').update(sql).digest('hex'),
    approvedDrops: [
      'commodities.group_id',
      'commodities.required_image_count',
      'commodities.cargo_type',
      'commodity_groups',
    ],
  };
}

export function validateCommodityContractPreflight(report) {
  if (!report.commoditiesExists) {
    throw new Error('Contract preflight: commodities table is missing');
  }
  if (!report.commodityTypesExists || report.commodityTypeCount < 1) {
    throw new Error(
      'Contract preflight: populated commodity_types catalog is required',
    );
  }
  if (!report.commodityGroupsExists) {
    throw new Error('Contract preflight: commodity_groups is already absent');
  }
  const columns = new Set(report.commodityColumns);
  for (const column of ['group_id', 'required_image_count', 'cargo_type']) {
    if (!columns.has(column)) {
      throw new Error(`Contract preflight: commodities.${column} is missing`);
    }
  }
  if (report.duplicateCommodityKeys.length > 0) {
    throw new Error(
      'Contract preflight: duplicate Commodity names remain within a Service',
    );
  }
  if (report.unexpectedGroupReferences.length > 0) {
    throw new Error(
      'Contract preflight: commodity_groups has unapproved foreign-key dependents',
    );
  }
  if (!report.protectedSnapshots.cargoTypes.exists) {
    throw new Error(
      'Contract preflight: cargo_types protection snapshot is missing',
    );
  }
  if (!report.protectedSnapshots.packageTypes.exists) {
    throw new Error(
      'Contract preflight: package_types protection snapshot is missing',
    );
  }
}

export function validateCommodityContractPostflight(before, after) {
  if (after.commodityGroupsExists) {
    throw new Error('Contract postflight: commodity_groups still exists');
  }
  const columns = new Set(after.commodityColumns);
  for (const column of ['group_id', 'required_image_count', 'cargo_type']) {
    if (columns.has(column)) {
      throw new Error(
        `Contract postflight: commodities.${column} still exists`,
      );
    }
  }
  if (!after.independentUniqueIndex) {
    throw new Error(
      'Contract postflight: independent Commodity uniqueness index is missing',
    );
  }
  for (const table of ['cargoTypes', 'packageTypes']) {
    if (
      JSON.stringify(after.protectedSnapshots[table]) !==
      JSON.stringify(before.protectedSnapshots[table])
    ) {
      throw new Error(
        `Contract postflight: protected ${table} table changed unexpectedly`,
      );
    }
  }
}

export async function collectCommodityContractRecoverySnapshot(client) {
  const commodityGroups = (
    await client.query('SELECT * FROM public.commodity_groups ORDER BY id')
  ).rows;
  const commoditiesLegacy = (
    await client.query(`
      SELECT id, service_type_id, group_id, required_image_count, cargo_type
        FROM public.commodities
       ORDER BY id
    `)
  ).rows;
  const columns = (
    await client.query(`
      SELECT table_name, column_name, ordinal_position, data_type, udt_name,
             is_nullable, column_default, character_maximum_length
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('commodities', 'commodity_groups')
       ORDER BY table_name, ordinal_position
    `)
  ).rows;
  const constraints = (
    await client.query(`
      SELECT conrelid::regclass::text AS table_name, conname, contype,
             pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
       WHERE conrelid IN (
         'public.commodities'::regclass,
         'public.commodity_groups'::regclass
       )
       ORDER BY table_name, conname
    `)
  ).rows;
  const indexes = (
    await client.query(`
      SELECT tablename, indexname, indexdef
        FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename IN ('commodities', 'commodity_groups')
       ORDER BY tablename, indexname
    `)
  ).rows;
  return {
    commodityGroups,
    commoditiesLegacy,
    schema: { columns, constraints, indexes },
  };
}

export function createCommodityContractRecoveryEnvelope(snapshot, evidence) {
  const exactSnapshot = cloneJson(snapshot);
  return {
    format: 'seatrans-commodity-groups-contract-recovery-v1',
    scope: [
      'commodity_groups.*',
      'commodities.group_id',
      'commodities.required_image_count',
      'commodities.cargo_type',
      'schema.columns',
      'schema.constraints',
      'schema.indexes',
    ],
    checksum: checksumJson(exactSnapshot),
    snapshot: exactSnapshot,
    evidence: {
      backupReference: evidence.backupReference,
      observationReference: evidence.observationReference,
      restoreTested: true,
      restoreTestReference: evidence.restoreTestReference,
      restoreProcedure:
        'Restore the provider backup, or recreate captured schema metadata and reload commodity_groups before restoring the three Commodity legacy columns by id.',
    },
  };
}

export function writeCommodityContractRecoveryExport(path, envelope) {
  writeFileSync(path, `${JSON.stringify(envelope, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return readCommodityContractRecoveryExport(path);
}

export function readCommodityContractRecoveryExport(path) {
  const envelope = JSON.parse(readFileSync(path, 'utf8'));
  if (envelope.format !== 'seatrans-commodity-groups-contract-recovery-v1') {
    throw new Error('Contract recovery export format is unsupported');
  }
  if (checksumJson(envelope.snapshot) !== envelope.checksum) {
    throw new Error('Contract recovery export checksum mismatch');
  }
  const snapshot = envelope.snapshot;
  if (
    !Array.isArray(snapshot?.commodityGroups) ||
    !Array.isArray(snapshot?.commoditiesLegacy) ||
    !Array.isArray(snapshot?.schema?.columns) ||
    !Array.isArray(snapshot?.schema?.constraints) ||
    !Array.isArray(snapshot?.schema?.indexes)
  ) {
    throw new Error('Contract recovery export is missing targeted data');
  }
  if (
    envelope.evidence?.restoreTested !== true ||
    !String(envelope.evidence?.restoreTestReference ?? '').trim()
  ) {
    throw new Error('Contract recovery export lacks restore-tested evidence');
  }
  return envelope;
}

function verifyContractApplyGuards(args, config) {
  if (!args.apply) return null;
  if (!args.backupReference?.trim()) {
    throw new Error('--backup-reference is required for contract --apply');
  }
  if (!args.logicalExport) {
    throw new Error('--logical-export is required for contract --apply');
  }
  if (!args.observationReference?.trim()) {
    throw new Error('--observation-reference is required for contract --apply');
  }
  if (!args.restoreTestReference?.trim()) {
    throw new Error(
      '--restore-test-reference is required for contract --apply',
    );
  }
  if (args.confirmation !== CONTRACT_CONFIRMATION) {
    throw new Error(`--confirm must equal ${CONTRACT_CONFIRMATION}`);
  }
  if (!args.targetDb || args.targetDb !== config.database) {
    throw new Error(
      '--target-db must exactly match the configured database name',
    );
  }
  if (!isAbsolute(args.logicalExport)) {
    throw new Error('--logical-export must be an absolute path');
  }
  const path = resolve(args.logicalExport);
  const projectRelative = relative(PROJECT_ROOT, path);
  if (
    projectRelative === '' ||
    (!projectRelative.startsWith('..') && !isAbsolute(projectRelative))
  ) {
    throw new Error('--logical-export must be stored outside backend2.0');
  }
  if (!existsSync(dirname(path)) || !statSync(dirname(path)).isDirectory()) {
    throw new Error('--logical-export parent must be an existing directory');
  }
  if (existsSync(path)) {
    throw new Error('--logical-export refuses to overwrite an existing file');
  }
  return { path };
}

async function protectedTableSnapshot(client, tableName, exists) {
  if (!exists) return { exists: false, rowCount: 0, checksum: null };
  const result = await client.query(`
    SELECT count(*)::integer AS "rowCount",
           md5(coalesce(string_agg(to_jsonb(row_value)::text, '|'
             ORDER BY to_jsonb(row_value)::text), '')) AS checksum
      FROM public.${tableName} AS row_value
  `);
  return { exists: true, ...result.rows[0] };
}

async function inspectCommodityContract(client, checksum) {
  const relations = (
    await client.query(`
      SELECT
        to_regclass('public.commodities') IS NOT NULL AS "commoditiesExists",
        to_regclass('public.commodity_types') IS NOT NULL AS "commodityTypesExists",
        to_regclass('public.commodity_groups') IS NOT NULL AS "commodityGroupsExists",
        to_regclass('public.cargo_types') IS NOT NULL AS "cargoTypesExists",
        to_regclass('public.package_types') IS NOT NULL AS "packageTypesExists",
        to_regclass('public.app_schema_migrations') IS NOT NULL AS "ledgerExists"
    `)
  ).rows[0];
  const commodityColumns = relations.commoditiesExists
    ? (
        await client.query(`
          SELECT column_name
            FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'commodities'
           ORDER BY ordinal_position
        `)
      ).rows.map((row) => row.column_name)
    : [];
  const commodityTypeCount = relations.commodityTypesExists
    ? Number(
        (
          await client.query(
            'SELECT count(*)::integer AS count FROM public.commodity_types',
          )
        ).rows[0].count,
      )
    : 0;
  const duplicateCommodityKeys = relations.commoditiesExists
    ? (
        await client.query(`
          SELECT service_type_id, lower(regexp_replace(btrim(name),
                   '[[:space:]_/-]+', ' ', 'g')) AS normalized_name,
                 count(*)::integer AS row_count
            FROM public.commodities
           GROUP BY service_type_id,
             lower(regexp_replace(btrim(name), '[[:space:]_/-]+', ' ', 'g'))
          HAVING count(*) > 1
           ORDER BY service_type_id, normalized_name
        `)
      ).rows
    : [];
  const groupReferences = relations.commodityGroupsExists
    ? (
        await client.query(`
          SELECT conname, conrelid::regclass::text AS source_table,
                 pg_get_constraintdef(oid) AS definition
            FROM pg_constraint
           WHERE contype = 'f'
             AND confrelid = 'public.commodity_groups'::regclass
           ORDER BY conname
        `)
      ).rows
    : [];
  const unexpectedGroupReferences = groupReferences.filter((row) => {
    const source = String(row.source_table).replace(/^public\./, '');
    return !(
      source === 'commodities' &&
      /FOREIGN KEY \(group_id\)/i.test(String(row.definition))
    );
  });
  const independentUniqueIndex = relations.commoditiesExists
    ? (
        await client.query(`
          SELECT EXISTS (
            SELECT 1 FROM pg_indexes
             WHERE schemaname = 'public'
               AND tablename = 'commodities'
               AND indexname = 'uq_commodities_service_name_normalized'
               AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
          ) AS present
        `)
      ).rows[0].present === true
    : false;
  const ledger = relations.ledgerExists
    ? ((
        await client.query(
          `SELECT status, script_checksum AS "scriptChecksum"
             FROM public.app_schema_migrations WHERE migration_id = $1`,
          [CONTRACT_MIGRATION_ID],
        )
      ).rows[0] ?? null)
    : null;
  return {
    ...relations,
    commodityColumns,
    commodityTypeCount,
    duplicateCommodityKeys,
    unexpectedGroupReferences,
    independentUniqueIndex,
    protectedSnapshots: {
      cargoTypes: await protectedTableSnapshot(
        client,
        'cargo_types',
        relations.cargoTypesExists,
      ),
      packageTypes: await protectedTableSnapshot(
        client,
        'package_types',
        relations.packageTypesExists,
      ),
    },
    ledger,
    ledgerChecksumMatches: ledger == null || ledger.scriptChecksum === checksum,
  };
}

async function inspectCommodityContractReadOnly(client, checksum) {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    await client.query(`SET LOCAL statement_timeout = '30s'`);
    const report = await inspectCommodityContract(client, checksum);
    await client.query('ROLLBACK');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function collectCommodityContractRecoverySnapshotReadOnly(client) {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    await client.query(`SET LOCAL statement_timeout = '30s'`);
    const snapshot = await collectCommodityContractRecoverySnapshot(client);
    await client.query('ROLLBACK');
    return snapshot;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function runCommodityContractMigration(args) {
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  loadEnvFile(join(PROJECT_ROOT, '.env.local'));
  const config = buildClientConfig();
  const sql = readFileSync(CONTRACT_SQL_PATH, 'utf8');
  verifyCommodityContractStatic(sql);
  const checksum = createHash('sha256').update(sql).digest('hex');
  const logicalExport = verifyContractApplyGuards(args, config);
  const client = new pg.Client(config);
  await client.connect();
  let lockAcquired = false;
  try {
    if (!args.apply) {
      const before = await inspectCommodityContractReadOnly(client, checksum);
      validateCommodityContractPreflight(before);
      console.log(
        JSON.stringify(
          { mode: 'dry-run', phase: 'contract', preflight: before },
          null,
          2,
        ),
      );
      console.log(
        'Dry-run only. Contract inspection used a READ ONLY transaction; no writes occurred.',
      );
      return;
    }
    const lock = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [CONTRACT_LOCK_NAME],
    );
    lockAcquired = lock.rows[0]?.acquired === true;
    if (!lockAcquired) {
      throw new Error('Another Commodity contract migration is running');
    }
    await ensureLedger(client);
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query(`SET LOCAL lock_timeout = '5s'`);
      await client.query(`SET LOCAL statement_timeout = '5min'`);
      await client.query(
        'LOCK TABLE public.commodities, public.commodity_groups IN SHARE ROW EXCLUSIVE MODE',
      );
      const before = await inspectCommodityContract(client, checksum);
      if (!before.ledgerChecksumMatches) {
        throw new Error(
          'Contract preflight: ledger checksum differs from immutable SQL',
        );
      }
      if (before.ledger?.status === 'SUCCEEDED') {
        throw new Error(
          'Contract preflight: ledger already says SUCCEEDED; inspect the contracted schema instead of reapplying',
        );
      }
      validateCommodityContractPreflight(before);
      const recoverySnapshot =
        await collectCommodityContractRecoverySnapshot(client);
      const recoveryEnvelope = createCommodityContractRecoveryEnvelope(
        recoverySnapshot,
        {
          backupReference: args.backupReference.trim(),
          observationReference: args.observationReference.trim(),
          restoreTestReference: args.restoreTestReference.trim(),
        },
      );
      const verifiedRecovery = writeCommodityContractRecoveryExport(
        logicalExport.path,
        recoveryEnvelope,
      );
      await client.query(
        `INSERT INTO app_schema_migrations (
           migration_id, script_checksum, status, backup_reference,
           logical_export_reference, started_at, completed_at, details
         ) VALUES ($1, $2, 'RUNNING', $3, $4, NOW(), NULL, $5::jsonb)
         ON CONFLICT (migration_id) DO UPDATE SET
           status = 'RUNNING', backup_reference = EXCLUDED.backup_reference,
           logical_export_reference = EXCLUDED.logical_export_reference,
           started_at = NOW(), completed_at = NULL, details = EXCLUDED.details`,
        [
          CONTRACT_MIGRATION_ID,
          checksum,
          args.backupReference.trim(),
          logicalExport.path,
          JSON.stringify({
            observationReference: args.observationReference.trim(),
            restoreTestReference: args.restoreTestReference.trim(),
            recoveryExportChecksum: verifiedRecovery.checksum,
            before,
          }),
        ],
      );
      await client.query(sql);
      const after = await inspectCommodityContract(client, checksum);
      validateCommodityContractPostflight(before, after);
      await client.query(
        `UPDATE app_schema_migrations SET status = 'SUCCEEDED', completed_at = NOW(),
          details = $2::jsonb WHERE migration_id = $1`,
        [
          CONTRACT_MIGRATION_ID,
          JSON.stringify({
            observationReference: args.observationReference.trim(),
            restoreTestReference: args.restoreTestReference.trim(),
            recoveryExportChecksum: verifiedRecovery.checksum,
            before,
            after,
          }),
        ],
      );
      await client.query('COMMIT');
      console.log(
        JSON.stringify(
          { committed: true, phase: 'contract', postflight: after },
          null,
          2,
        ),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
        CONTRACT_LOCK_NAME,
      ]);
    }
    await client.end();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.verifyStatic) {
    if (args.phase === 'contract') {
      const sql = readFileSync(CONTRACT_SQL_PATH, 'utf8');
      console.log(
        JSON.stringify(
          {
            staticVerification: {
              phase: 'contract',
              ...verifyCommodityContractStatic(sql),
              destructiveApplyRequires: [
                'exact database target',
                'fresh backup reference',
                'external non-empty logical export',
                'approved observation reference',
                'restore-tested attestation reference',
                'exact confirmation',
                'advisory lock',
              ],
            },
          },
          null,
          2,
        ),
      );
      return;
    }
    if (args.phase === 'duplicate-data') {
      const sql = readFileSync(DUPLICATE_DATA_SQL_PATH, 'utf8');
      console.log(
        JSON.stringify(
          {
            staticVerification: {
              phase: 'duplicate-data',
              sqlChecksum: createHash('sha256').update(sql).digest('hex'),
              importSafe: true,
              destructiveApplyRequires: [
                'exact database target',
                'backup reference',
                'external checksummed logical export',
                'restore-tested attestation reference',
                'roll-forward-tested attestation reference',
                'exact confirmation',
                'advisory lock',
              ],
              recoveryScope: [
                'commodities',
                'gallery_images',
                'shipping_agency_inquiries',
                ...DOCUMENT_PAYLOAD_TABLES,
              ],
            },
          },
          null,
          2,
        ),
      );
      return;
    }
    if (args.phase === 'inquiry-expand') {
      const sql = readFileSync(INQUIRY_SQL_PATH, 'utf8');
      console.log(
        JSON.stringify(
          {
            staticVerification: {
              phase: 'inquiry-expand',
              sqlChecksum: createHash('sha256').update(sql).digest('hex'),
              importSafe: true,
            },
          },
          null,
          2,
        ),
      );
      return;
    }
    if (args.phase === 'gallery-expand') {
      const sql = readFileSync(GALLERY_SQL_PATH, 'utf8');
      console.log(
        JSON.stringify(
          {
            staticVerification: {
              phase: 'gallery-expand',
              sqlChecksum: createHash('sha256').update(sql).digest('hex'),
              importSafe: true,
            },
          },
          null,
          2,
        ),
      );
      return;
    }
    if (args.phase === 'data') {
      const sql = readFileSync(DATA_SQL_PATH, 'utf8');
      console.log(
        JSON.stringify(
          {
            staticVerification: {
              phase: 'data',
              sqlChecksum: createHash('sha256').update(sql).digest('hex'),
              rollForwardRecovery: true,
            },
          },
          null,
          2,
        ),
      );
      return;
    }
    console.log(
      JSON.stringify({ staticVerification: verifyStaticContract() }, null, 2),
    );
    return;
  }
  if (args.phase === 'contract') {
    await runCommodityContractMigration(args);
    return;
  }
  if (args.phase === 'duplicate-data') {
    await runIndependentCommodityDataMigration(args);
    return;
  }
  if (args.phase === 'inquiry-expand') {
    await runInquiryIdsExpandMigration(args);
    return;
  }
  if (args.phase === 'gallery-expand') {
    await runGalleryTypeExpandMigration(args);
    return;
  }
  if (args.phase === 'data') {
    await runCommodityTypeDataMigration(args);
    return;
  }
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  loadEnvFile(join(PROJECT_ROOT, '.env.local'));
  const config = buildClientConfig();
  const sql = readFileSync(SQL_PATH, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const logicalExport = verifyApplyGuards(args, config);
  const client = new pg.Client(config);
  await client.connect();
  let lockAcquired = false;
  try {
    const before = await inspectReadOnly(client, checksum);
    validatePreflight(before);
    console.log(
      JSON.stringify(
        { mode: args.apply ? 'apply' : 'dry-run', preflight: before },
        null,
        2,
      ),
    );
    if (!args.apply) {
      console.log(
        'Dry-run only. The inspection used a READ ONLY transaction; no writes occurred.',
      );
      return;
    }
    const lock = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [LOCK_NAME],
    );
    lockAcquired = lock.rows[0]?.acquired === true;
    if (!lockAcquired)
      throw new Error('Another Commodity Type migration is running');
    await ensureLedger(client);
    if (before.ledger?.status === 'SUCCEEDED') {
      validatePostflight(before, before);
      console.log('Migration already succeeded with the same checksum.');
      return;
    }
    await client.query(
      `INSERT INTO app_schema_migrations (
         migration_id, script_checksum, status, backup_reference,
         logical_export_reference, started_at, completed_at, details
       ) VALUES ($1, $2, 'RUNNING', $3, $4, NOW(), NULL, $5::jsonb)
       ON CONFLICT (migration_id) DO UPDATE SET
         status = 'RUNNING', backup_reference = EXCLUDED.backup_reference,
         logical_export_reference = EXCLUDED.logical_export_reference,
         started_at = NOW(), completed_at = NULL, details = EXCLUDED.details`,
      [
        MIGRATION_ID,
        checksum,
        args.backupReference,
        logicalExport.path,
        JSON.stringify({ before }),
      ],
    );
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '5s'`);
      await client.query(`SET LOCAL statement_timeout = '5min'`);
      await client.query(sql);
      const after = await inspectSchema(client, checksum);
      validatePostflight(before, after);
      await client.query('COMMIT');
      await client.query(
        `UPDATE app_schema_migrations SET status = 'SUCCEEDED', completed_at = NOW(),
          details = $2::jsonb WHERE migration_id = $1`,
        [MIGRATION_ID, JSON.stringify({ before, after })],
      );
      console.log(
        JSON.stringify({ committed: true, postflight: after }, null, 2),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      await client.query(
        `UPDATE app_schema_migrations SET status = 'FAILED', completed_at = NOW(),
          details = coalesce(details, '{}'::jsonb) || jsonb_build_object('error', $2::text)
          WHERE migration_id = $1`,
        [MIGRATION_ID, error instanceof Error ? error.message : String(error)],
      );
      throw error;
    }
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
        LOCK_NAME,
      ]);
    }
    await client.end();
  }
}

const isMain =
  process.argv[1] != null &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
