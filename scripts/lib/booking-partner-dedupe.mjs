import { createHash } from 'node:crypto';

export const MIGRATION_ID = '2026-08-20-booking-partner-dedupe';
export const APPLY_CONFIRMATION = 'APPLY_BOOKING_PARTNER_DEDUPE_20260820';
export const SIMULATE_CONFIRMATION = 'SIMULATE_BOOKING_PARTNER_DEDUPE_20260820';

export const PARTNER_PAIRS = [
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
];

export const RESOLVED_VALUES = {
  111: {
    address:
      'HAMLET 5, VAN HOI 2 VILLAGE, TUY PHUOC COMMUNE, GIA LAI PROVINCE, VIETNAM',
    customerStatus: 'LEAD',
    customerType: 'OTHER',
    invoiceCompanyName: 'HOANG THACH SON COMPANY LTD',
    invoiceCompanyAddress:
      'HAMLET 5, VAN HOI 2 VILLAGE, TUY PHUOC COMMUNE, GIA LAI PROVINCE, VIETNAM',
  },
  48: {
    address: 'SECTION 5, QUY NHON BAC WARD, GIA LAI PROVINCE, VIETNAM',
  },
  2: { customerStatus: 'LEAD' },
  19: {
    address: 'GROUP 10, AREA 7, QUY NHON TAY WARD, GIA LAI PROVINCE, VIETNAM',
    invoiceCompanyAddress:
      'GROUP 10, AREA 7, QUY NHON TAY WARD, GIA LAI PROVINCE, VIETNAM',
  },
  30: {
    city: 'Quy Nhon',
    address:
      'LOT B43, PHU TAI INDUSTRIAL ZONE, QUY NHON BAC WARD, GIA LAI PROVINCE, VIETNAM',
    invoiceCompanyAddress:
      'LOT B43, PHU TAI INDUSTRIAL ZONE, QUY NHON BAC WARD, GIA LAI PROVINCE, VIETNAM',
  },
  75: {
    name: 'NEW DRAGON GRANITE CO., LTD',
    address: '147 TANG BAT HO, QUY NHON WARD, GIA LAI PROVINCE, VIETNAM',
    customerStatus: 'LEAD',
    customerType: 'DIRECT',
    invoiceCompanyName: 'NEW DRAGON GRANITE CO., LTD',
    invoiceCompanyAddress:
      '147 TANG BAT HO, QUY NHON WARD, GIA LAI PROVINCE, VIETNAM',
  },
  32: {},
  13: {
    name: 'HONGC USING ENTERPRISE CO., LTD.',
    address:
      '5F.-2, NO. 81, SEC. 4, WENXIN RD., SHUINAN VIL., BEITUN DIST., TAICHUNG CITY 40667, TAIWAN (R.O.C.)',
    invoiceCompanyName: 'HONGC USING ENTERPRISE CO., LTD.',
    invoiceCompanyAddress:
      '5F.-2, NO. 81, SEC. 4, WENXIN RD., SHUINAN VIL., BEITUN DIST., TAICHUNG CITY 40667, TAIWAN (R.O.C.)',
  },
  23: {
    name: 'MIKUNI SANGYO CO., LTD',
    invoiceCompanyName: 'MIKUNI SANGYO CO., LTD',
  },
  35: {},
};

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

export function checksumTargets(targets) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(targets)))
    .digest('hex');
}

const blank = (value) =>
  value == null || (typeof value === 'string' && value.trim() === '');

const copyMissing = (keep, duplicate, field) => {
  if (blank(keep[field]) && !blank(duplicate[field]))
    keep[field] = duplicate[field];
};

const contactKey = (contact) => JSON.stringify(canonicalize(contact));

export function mergePairFixture(keepInput, duplicate, resolved = {}) {
  const keep = structuredClone(keepInput);
  const fields = [
    'name',
    'country',
    'city',
    'phone',
    'fax',
    'trackingUrl',
    'address',
    'customerStatus',
    'customerType',
    'taxNumber',
    'approveStatus',
    'approveBy',
    'companyEstablishmentDate',
    'paymentDueDays',
    'contractNo',
    'invoiceCompanyName',
    'invoiceCompanyAddress',
    'invoiceCompanyPhone',
    'invoiceCompanyEmail',
    'invoiceBankName',
    'invoiceBankBranch',
    'invoiceBankAccount',
    'lockedAt',
  ];
  for (const field of fields) copyMissing(keep, duplicate, field);
  keep.contacts = [
    ...new Map(
      [...(keep.contacts ?? []), ...(duplicate.contacts ?? [])].map(
        (contact) => [contactKey(contact), contact],
      ),
    ).values(),
  ];
  keep.additionTypes = [
    ...new Set([
      ...(keep.additionTypes ?? []),
      ...(duplicate.additionTypes ?? []),
    ]),
  ].sort();
  Object.assign(keep, resolved);
  return keep;
}

export function validatePairConfiguration() {
  const keepIds = PARTNER_PAIRS.map(({ keepId }) => keepId);
  const duplicateIds = PARTNER_PAIRS.map(({ duplicateId }) => duplicateId);
  const allIds = [...keepIds, ...duplicateIds];
  if (new Set(allIds).size !== allIds.length) {
    throw new Error('Partner dedupe IDs must be unique');
  }
  for (const keepId of keepIds) {
    if (!RESOLVED_VALUES[keepId]) {
      throw new Error(`Missing resolved values for keeper ${keepId}`);
    }
  }
  return { keepIds, duplicateIds, allIds };
}
