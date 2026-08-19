import { createHash } from 'node:crypto';

const MUTATING_SQL_PATTERN =
  /\b(?:insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|comment|vacuum|reindex|cluster|copy|call|execute|do|refresh|replace|upsert)\b/i;

export const COMMODITY_TYPES_SQL = `
SELECT
  ct.id,
  ct.service_type_id AS "serviceTypeId",
  st.name AS "serviceName",
  st.display_name AS "serviceDisplayName",
  ct.code,
  ct.name
FROM public.commodity_types ct
JOIN public.service_types st ON st.id = ct.service_type_id
ORDER BY ct.service_type_id, UPPER(BTRIM(ct.code)), ct.id;
`;

export const SHIPPING_AGENCY_INQUIRIES_SQL = `
SELECT
  inquiry.id,
  inquiry.cargo_type AS "cargoType",
  inquiry.commodity_type_id AS "commodityTypeId"
FROM public.shipping_agency_inquiries inquiry
ORDER BY inquiry.id;
`;

export const EPDA_PARAMETER_SETS_SQL = `
SELECT
  parameter_set.id,
  parameter_set.scope,
  parameter_set.area,
  parameter_set.port_id AS "portId",
  parameter_set.name,
  parameter_set.values
FROM public.epda_parameter_set parameter_set
ORDER BY parameter_set.id;
`;

export const SERVICE_TYPES_SQL = `
SELECT id, name, display_name AS "displayName"
FROM public.service_types
ORDER BY id;
`;

export function normalizeTypeKey(value) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toUpperCase();
}

function normalizeSnapshotKey(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

function numericId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function stableCompare(left, right) {
  return String(left).localeCompare(String(right), 'en');
}

function stripSqlCommentsAndLiterals(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, "''")
    .replace(/'(?:''|[^'])*'/g, "''");
}

export function assertReadOnlySql(sql) {
  if (typeof sql !== 'string' || sql.trim() === '') {
    throw new Error('Preflight contains empty SQL');
  }
  const executable = stripSqlCommentsAndLiterals(sql);
  if (
    MUTATING_SQL_PATTERN.test(executable) ||
    /\bselect\b[\s\S]*?\binto\b/i.test(executable) ||
    !/^\s*(?:select|with)\b/i.test(executable)
  ) {
    throw new Error('Preflight contains mutating SQL');
  }
}

function normalizedTypeRow(row) {
  return {
    id: numericId(row.id),
    serviceTypeId: numericId(row.serviceTypeId),
    serviceName: row.serviceName ?? null,
    serviceDisplayName: row.serviceDisplayName ?? null,
    code: row.code ?? null,
    name: row.name ?? null,
    normalizedCode: normalizeTypeKey(row.code),
    normalizedName: normalizeTypeKey(row.name),
  };
}

function buildAmbiguities(rows, field, outputField) {
  const groups = new Map();
  for (const row of rows) {
    const normalized = row[field];
    const key = `${row.serviceTypeId}:${normalized}`;
    const group = groups.get(key) ?? {
      serviceTypeId: row.serviceTypeId,
      serviceName: row.serviceName,
      [outputField]: normalized,
      typeIds: [],
    };
    group.typeIds.push(row.id);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.typeIds.length > 1)
    .map((group) => ({
      ...group,
      typeIds: group.typeIds.sort((left, right) => left - right),
    }))
    .sort(
      (left, right) =>
        left.serviceTypeId - right.serviceTypeId ||
        stableCompare(left[outputField], right[outputField]),
    );
}

export function buildCommodityTypeReport(inputRows) {
  const rows = inputRows
    .map(normalizedTypeRow)
    .sort(
      (left, right) =>
        left.serviceTypeId - right.serviceTypeId || left.id - right.id,
    );
  return {
    rows,
    codeAmbiguities: buildAmbiguities(rows, 'normalizedCode', 'normalizedCode'),
    nameAmbiguities: buildAmbiguities(rows, 'normalizedName', 'normalizedName'),
  };
}

function codeCandidates(types, serviceTypeId, value) {
  const normalizedValue = normalizeTypeKey(value);
  if (!normalizedValue) return [];
  return types
    .filter(
      (type) =>
        type.serviceTypeId === serviceTypeId &&
        type.normalizedCode === normalizedValue,
    )
    .map((type) => type.id)
    .sort((left, right) => left - right);
}

export function buildInquiryCargoTypeReport(
  inquiries,
  commodityTypes,
  shippingAgencyServiceTypeId,
) {
  const types = commodityTypes.map(normalizedTypeRow);
  const rows = inquiries
    .map((inquiry) => {
      const candidateTypeIds = codeCandidates(
        types,
        shippingAgencyServiceTypeId,
        inquiry.cargoType,
      );
      const commodityTypeId = numericId(inquiry.commodityTypeId);
      return {
        inquiryId: numericId(inquiry.id),
        cargoType: inquiry.cargoType ?? null,
        normalizedCargoType: normalizeTypeKey(inquiry.cargoType),
        commodityTypeId,
        candidateTypeIds,
        storedIdMatchesCandidate:
          commodityTypeId === null
            ? null
            : candidateTypeIds.includes(commodityTypeId),
      };
    })
    .sort((left, right) => left.inquiryId - right.inquiryId);
  const unresolved = rows.filter((row) => row.candidateTypeIds.length === 0);
  const multiplyResolved = rows.filter(
    (row) => row.candidateTypeIds.length > 1,
  );
  const storedIdMismatches = rows.filter(
    (row) => row.storedIdMatchesCandidate === false,
  );
  return {
    summary: {
      inquiryCount: rows.length,
      uniquelyResolvedCount: rows.filter(
        (row) => row.candidateTypeIds.length === 1,
      ).length,
      unresolvedCount: unresolved.length,
      multiplyResolvedCount: multiplyResolved.length,
      storedIdMismatchCount: storedIdMismatches.length,
    },
    rows,
    unresolved,
    multiplyResolved,
    storedIdMismatches,
  };
}

function numericRateValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function checksumNumericRates(rows) {
  const payload = rows.map((row) => ({
    parameterSetId: row.parameterSetId,
    rateIndex: row.rateIndex,
    rate: row.rate,
  }));
  return {
    algorithm: 'sha256',
    rateCount: payload.length,
    sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
  };
}

export function buildEpdaRateReport(
  parameterSets,
  commodityTypes,
  shippingAgencyServiceTypeId,
) {
  const types = commodityTypes.map(normalizedTypeRow);
  const rows = [];
  const malformedRates = [];

  for (const parameterSet of parameterSets) {
    const rates = parameterSet.values?.cargoAgencyRates;
    if (rates === undefined || rates === null) continue;
    if (!Array.isArray(rates)) {
      malformedRates.push({
        parameterSetId: numericId(parameterSet.id),
        reason: 'cargoAgencyRates is not an array',
      });
      continue;
    }
    rates.forEach((rate, rateIndex) => {
      const numericRate = numericRateValue(rate?.rate);
      const candidateTypeIds = codeCandidates(
        types,
        shippingAgencyServiceTypeId,
        rate?.code,
      );
      const row = {
        parameterSetId: numericId(parameterSet.id),
        scope: parameterSet.scope ?? null,
        area: parameterSet.area ?? null,
        portId: numericId(parameterSet.portId),
        name: parameterSet.name ?? null,
        rateIndex,
        code: rate?.code ?? null,
        normalizedCode: normalizeTypeKey(rate?.code),
        label: rate?.label ?? null,
        rate: numericRate,
        candidateTypeIds,
      };
      rows.push(row);
      if (numericRate === null) {
        malformedRates.push({
          parameterSetId: row.parameterSetId,
          rateIndex,
          reason: 'rate is not a finite number',
        });
      }
    });
  }

  rows.sort(
    (left, right) =>
      left.parameterSetId - right.parameterSetId ||
      left.rateIndex - right.rateIndex,
  );
  const unresolved = rows.filter((row) => row.candidateTypeIds.length === 0);
  const multiplyResolved = rows.filter(
    (row) => row.candidateTypeIds.length > 1,
  );
  return {
    summary: {
      parameterSetCount: parameterSets.length,
      rateCount: rows.length,
      uniquelyResolvedCount: rows.filter(
        (row) => row.candidateTypeIds.length === 1,
      ).length,
      unresolvedCount: unresolved.length,
      multiplyResolvedCount: multiplyResolved.length,
      malformedRateCount: malformedRates.length,
    },
    rows,
    unresolved,
    multiplyResolved,
    malformedRates,
    numericRateChecksum: checksumNumericRates(rows),
  };
}

function countInquiryCargoTypes(rows) {
  return Object.fromEntries(
    [
      ...rows.reduce((counts, row) => {
        const key = normalizeSnapshotKey(row.cargoType) || '<BLANK>';
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return counts;
      }, new Map()),
    ].sort(([left], [right]) => stableCompare(left, right)),
  );
}

export function buildCommodityTypeCodeRemovalPreflight({
  commodityTypes,
  inquiries,
  epdaParameterSets,
  shippingAgencyServiceTypeId,
}) {
  const typeReport = buildCommodityTypeReport(commodityTypes);
  const inquiryReport = buildInquiryCargoTypeReport(
    inquiries,
    typeReport.rows,
    shippingAgencyServiceTypeId,
  );
  const epdaRateReport = buildEpdaRateReport(
    epdaParameterSets,
    typeReport.rows,
    shippingAgencyServiceTypeId,
  );
  const blockers = [
    ...typeReport.codeAmbiguities.map((item) => ({
      kind: 'AMBIGUOUS_TYPE_CODE',
      ...item,
    })),
    ...inquiryReport.unresolved.map((item) => ({
      kind: 'UNRESOLVED_INQUIRY_CARGO_TYPE',
      inquiryId: item.inquiryId,
      cargoType: item.cargoType,
    })),
    ...inquiryReport.multiplyResolved.map((item) => ({
      kind: 'AMBIGUOUS_INQUIRY_CARGO_TYPE',
      inquiryId: item.inquiryId,
      cargoType: item.cargoType,
      candidateTypeIds: item.candidateTypeIds,
    })),
    ...inquiryReport.storedIdMismatches.map((item) => ({
      kind: 'INQUIRY_STORED_TYPE_ID_MISMATCH',
      inquiryId: item.inquiryId,
      commodityTypeId: item.commodityTypeId,
      candidateTypeIds: item.candidateTypeIds,
    })),
    ...epdaRateReport.unresolved.map((item) => ({
      kind: 'UNRESOLVED_EPDA_RATE_CODE',
      parameterSetId: item.parameterSetId,
      rateIndex: item.rateIndex,
      code: item.code,
    })),
    ...epdaRateReport.multiplyResolved.map((item) => ({
      kind: 'AMBIGUOUS_EPDA_RATE_CODE',
      parameterSetId: item.parameterSetId,
      rateIndex: item.rateIndex,
      code: item.code,
      candidateTypeIds: item.candidateTypeIds,
    })),
    ...epdaRateReport.malformedRates.map((item) => ({
      kind: 'MALFORMED_EPDA_RATE',
      ...item,
    })),
  ];

  return {
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
    shippingAgencyServiceTypeId,
    summary: {
      commodityTypeCount: typeReport.rows.length,
      typeCodeAmbiguityCount: typeReport.codeAmbiguities.length,
      typeNameAmbiguityCount: typeReport.nameAmbiguities.length,
      inquiryCount: inquiryReport.rows.length,
      inquiryCargoTypeCounts: countInquiryCargoTypes(inquiryReport.rows),
      inquiryUnresolvedCount: inquiryReport.unresolved.length,
      inquiryMultiplyResolvedCount: inquiryReport.multiplyResolved.length,
      epdaRateCount: epdaRateReport.rows.length,
      epdaRateUnresolvedCount: epdaRateReport.unresolved.length,
      epdaRateMultiplyResolvedCount: epdaRateReport.multiplyResolved.length,
      blockerCount: blockers.length,
    },
    commodityTypes: typeReport,
    inquiries: inquiryReport,
    epdaRates: epdaRateReport,
    blockers,
  };
}

export function findShippingAgencyServiceTypeId(serviceTypes) {
  const expected = 'SHIPPING AGENCY';
  const candidates = serviceTypes.filter(
    (serviceType) =>
      normalizeTypeKey(serviceType.name).replace(/_/g, ' ') === expected ||
      normalizeTypeKey(serviceType.displayName).replace(/_/g, ' ') === expected,
  );
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one Shipping Agency Service, found ${candidates.length}`,
    );
  }
  return numericId(candidates[0].id);
}
