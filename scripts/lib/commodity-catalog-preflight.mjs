const MUTATING_SQL_PATTERN =
  /\b(?:insert|update|delete|truncate|drop|alter|create|grant|revoke|comment|vacuum|reindex|cluster|copy)\b/i;

const REFERENCE_FIELDS = [
  'galleryReferences',
  'bookingReferences',
  'arrivalNoticeReferences',
  'deliveryOrderReferences',
  'billOfLadingReferences',
  'inquiryReferences',
];

export const CARGO_TYPES_SQL = `
SELECT
  ct.code,
  ct.service_type_type AS "serviceTypeType",
  ct.display_label AS "displayLabel",
  ct.is_active AS "isActive",
  ct.has_cargo_name AS "hasCargoName"
FROM cargo_types ct
ORDER BY ct.service_type_type, ct.code;
`;

export const COMMODITY_GROUPS_SQL = `
SELECT
  cg.id,
  cg.service_type_id AS "serviceTypeId",
  st.name AS "serviceName",
  st.display_name AS "serviceDisplayName",
  cg.name,
  COUNT(c.id)::int AS "commodityCount"
FROM commodity_groups cg
JOIN service_types st ON st.id = cg.service_type_id
LEFT JOIN commodities c ON c.group_id = cg.id
GROUP BY cg.id, cg.service_type_id, st.name, st.display_name, cg.name
ORDER BY cg.service_type_id, UPPER(BTRIM(cg.name)), cg.id;
`;

export const COMMODITY_REFERENCES_SQL = `
WITH commodity_identity AS (
  SELECT
    c.id,
    c.service_type_id,
    st.name AS service_name,
    c.group_id,
    cg.name AS group_name,
    c.name,
    c.display_name,
    c.description,
    c.cargo_type,
    c.required_image_count,
    c.created_at,
    ARRAY_REMOVE(ARRAY[
      LOWER(BTRIM(c.name)),
      LOWER(BTRIM(c.display_name)),
      CASE
        WHEN cg.name IS NULL THEN NULL
        ELSE LOWER(BTRIM(c.display_name) || ' IN ' || BTRIM(cg.name))
      END
    ], NULL) AS name_keys
  FROM commodities c
  JOIN service_types st ON st.id = c.service_type_id
  LEFT JOIN commodity_groups cg ON cg.id = c.group_id
)
SELECT
  c.id,
  c.service_type_id AS "serviceTypeId",
  c.service_name AS "serviceName",
  c.group_id AS "groupId",
  c.group_name AS "groupName",
  c.name,
  c.display_name AS "displayName",
  c.description,
  c.cargo_type AS "cargoType",
  c.required_image_count AS "requiredImageCount",
  c.created_at AS "createdAt",
  (SELECT COUNT(*)::int FROM gallery_images gi WHERE gi.commodity_id = c.id)
    AS "galleryReferences",
  (SELECT COUNT(*)::int FROM booking_records d
    WHERE ((d.payload->>'commodityId') ~ '^[0-9]+$' AND (d.payload->>'commodityId')::int = c.id)
       OR LOWER(BTRIM(COALESCE(d.payload->>'commodity', ''))) = ANY(c.name_keys)
       OR LOWER(BTRIM(COALESCE(d.payload->>'descriptionOfGoods', ''))) = ANY(c.name_keys))
    AS "bookingReferences",
  (SELECT COUNT(*)::int FROM arrival_notice_records d
    WHERE ((d.payload->>'commodityId') ~ '^[0-9]+$' AND (d.payload->>'commodityId')::int = c.id)
       OR LOWER(BTRIM(COALESCE(d.payload->>'commodity', ''))) = ANY(c.name_keys)
       OR LOWER(BTRIM(COALESCE(d.payload->>'descriptionOfGoods', ''))) = ANY(c.name_keys))
    AS "arrivalNoticeReferences",
  (SELECT COUNT(*)::int FROM delivery_order_records d
    WHERE ((d.payload->>'commodityId') ~ '^[0-9]+$' AND (d.payload->>'commodityId')::int = c.id)
       OR LOWER(BTRIM(COALESCE(d.payload->>'commodity', ''))) = ANY(c.name_keys)
       OR LOWER(BTRIM(COALESCE(d.payload->>'descriptionOfGoods', ''))) = ANY(c.name_keys))
    AS "deliveryOrderReferences",
  (SELECT COUNT(*)::int FROM bill_of_lading_records d
    WHERE ((d.payload->>'commodityId') ~ '^[0-9]+$' AND (d.payload->>'commodityId')::int = c.id)
       OR LOWER(BTRIM(COALESCE(d.payload->>'commodity', ''))) = ANY(c.name_keys)
       OR LOWER(BTRIM(COALESCE(d.payload->>'descriptionOfGoods', ''))) = ANY(c.name_keys))
    AS "billOfLadingReferences",
  (
    (SELECT COUNT(*)::int FROM shipping_agency_inquiries i
      WHERE LOWER(BTRIM(COALESCE(i.cargo_name, ''))) = ANY(c.name_keys)) +
    (SELECT COUNT(*)::int FROM freight_forwarding_inquiries i
      WHERE LOWER(BTRIM(COALESCE(i.cargo_name, ''))) = ANY(c.name_keys)) +
    (SELECT COUNT(*)::int FROM total_logistics_inquiries i
      WHERE LOWER(BTRIM(COALESCE(i.cargo_name, ''))) = ANY(c.name_keys))
  ) AS "inquiryReferences"
FROM commodity_identity c
ORDER BY c.service_type_id, UPPER(BTRIM(c.name)), c.id;
`;

export const PACKAGE_TYPES_SQL = `
WITH document_rows AS (
  SELECT 'AN'::text AS document_type, payload FROM arrival_notice_records
  UNION ALL
  SELECT 'BL'::text AS document_type, payload FROM bill_of_lading_records
  UNION ALL
  SELECT 'DO'::text AS document_type, payload FROM delivery_order_records
), package_values AS (
  SELECT
    document_type,
    BTRIM(container->>'packageType') AS value
  FROM document_rows
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(payload->'containers') = 'array' THEN payload->'containers'
      ELSE '[]'::jsonb
    END
  ) AS container
)
SELECT
  document_type AS "documentType",
  value,
  COUNT(*)::int AS occurrences
FROM package_values
WHERE value <> ''
GROUP BY document_type, value
ORDER BY UPPER(value), value, document_type;
`;

export function normalizeCatalogKey(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function parseCanonicalPackageTypesSql(sql) {
  const valuesBlock = sql.match(
    /-- CANONICAL_PACKAGE_TYPES_BEGIN([\s\S]*?)-- CANONICAL_PACKAGE_TYPES_END/,
  );
  if (!valuesBlock) {
    throw new Error('Canonical Package Type markers are missing');
  }
  const ordered = [...valuesBlock[1].matchAll(/\('((?:''|[^'])*)',\s*(\d+)\)/g)]
    .map((match) => ({
      displayName: match[1].replace(/''/g, "'"),
      sortOrder: Number(match[2]),
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder);
  if (ordered.length !== 101) {
    throw new Error(
      `Expected 101 canonical Package Types, found ${ordered.length}`,
    );
  }
  ordered.forEach((item, index) => {
    if (item.sortOrder !== index + 1) {
      throw new Error('Canonical Package Type sort order is not contiguous');
    }
  });
  return ordered.map((item) => item.displayName);
}

function numeric(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function totalReferences(row) {
  return REFERENCE_FIELDS.reduce((total, field) => total + numeric(row[field]), 0);
}

export function buildCommodityDuplicateReport(rows) {
  const groups = new Map();
  for (const row of rows) {
    const normalizedName = normalizeCatalogKey(row.name || row.displayName);
    if (!normalizedName) continue;
    const key = `${row.serviceTypeId}:${normalizedName}`;
    const group = groups.get(key) ?? {
      serviceTypeId: numeric(row.serviceTypeId),
      serviceName: row.serviceName,
      normalizedName,
      rows: [],
    };
    group.rows.push({ ...row, totalReferences: totalReferences(row) });
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter((group) => group.rows.length > 1)
    .map((group) => {
      const sortedRows = group.rows.sort(
        (left, right) =>
          right.totalReferences - left.totalReferences ||
          numeric(left.id) - numeric(right.id),
      );
      return {
        serviceTypeId: group.serviceTypeId,
        serviceName: group.serviceName,
        normalizedName: group.normalizedName,
        canonicalId: numeric(sortedRows[0].id),
        duplicateIds: sortedRows.slice(1).map((row) => numeric(row.id)),
        rows: sortedRows,
      };
    })
    .sort(
      (left, right) =>
        left.serviceTypeId - right.serviceTypeId ||
        left.normalizedName.localeCompare(right.normalizedName, 'en'),
    );
}

function compareVariant(left, right) {
  const leftUpper = left === left.toUpperCase();
  const rightUpper = right === right.toUpperCase();
  if (leftUpper !== rightUpper) return leftUpper ? -1 : 1;
  return left.localeCompare(right, 'en');
}

export function buildPackageTypeReport(rows, dashboardOptions) {
  const dashboardByKey = new Map(
    dashboardOptions.map((value) => [normalizeCatalogKey(value), value]),
  );
  const groups = new Map();

  for (const row of rows) {
    const value = typeof row.value === 'string' ? row.value.trim() : '';
    const normalizedValue = normalizeCatalogKey(value);
    if (!normalizedValue) continue;
    const group = groups.get(normalizedValue) ?? {
      normalizedValue,
      variants: new Set(),
      sources: new Map(),
      occurrences: 0,
    };
    const occurrences = numeric(row.occurrences);
    group.variants.add(value);
    group.sources.set(
      row.documentType,
      (group.sources.get(row.documentType) ?? 0) + occurrences,
    );
    group.occurrences += occurrences;
    groups.set(normalizedValue, group);
  }

  return [...groups.values()]
    .sort((left, right) =>
      left.normalizedValue.localeCompare(right.normalizedValue, 'en'),
    )
    .map((group) => {
      const variants = [...group.variants].sort(compareVariant);
      const dashboardValue = dashboardByKey.get(group.normalizedValue);
      return {
        normalizedValue: group.normalizedValue,
        displayValue: dashboardValue ?? variants[0],
        inDashboardOptions: Boolean(dashboardValue),
        occurrences: group.occurrences,
        sources: [...group.sources.entries()]
          .sort(([left], [right]) => left.localeCompare(right, 'en'))
          .map(([documentType, occurrences]) => ({
            documentType,
            occurrences,
          })),
        variants,
      };
    });
}

export function assertReadOnlySql(sql) {
  const withoutComments = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
  if (MUTATING_SQL_PATTERN.test(withoutComments)) {
    throw new Error('Preflight contains mutating SQL');
  }
}

export function buildPreflightReport({
  cargoTypes,
  groups,
  commodities,
  packageTypeRows,
  dashboardPackageTypes,
}) {
  const duplicates = buildCommodityDuplicateReport(commodities);
  const packageTypes = buildPackageTypeReport(
    packageTypeRows,
    dashboardPackageTypes,
  );
  return {
    summary: {
      cargoTypeCount: cargoTypes.length,
      groupCount: groups.length,
      commodityCount: commodities.length,
      duplicateKeyCount: duplicates.length,
      duplicateRowCount: duplicates.reduce(
        (total, duplicate) => total + duplicate.duplicateIds.length,
        0,
      ),
      dashboardPackageTypeCount: dashboardPackageTypes.length,
      storedPackageTypeCount: packageTypes.length,
    },
    cargoTypes,
    groups,
    commodities,
    duplicates,
    packageTypes,
  };
}
