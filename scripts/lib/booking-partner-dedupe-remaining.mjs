import { createHash } from 'node:crypto';

export const MIGRATION_ID = '2026-08-20-booking-partner-dedupe-remaining';
export const APPLY_CONFIRMATION =
  'APPLY_BOOKING_PARTNER_DEDUPE_REMAINING_20260820';
export const SIMULATE_CONFIRMATION =
  'SIMULATE_BOOKING_PARTNER_DEDUPE_REMAINING_20260820';

export const PARTNER_PAIRS = [
  { keepId: 33, duplicateId: 83 },
  { keepId: 42, duplicateId: 50 },
  { keepId: 109, duplicateId: 97 },
  { keepId: 65, duplicateId: 64 },
  { keepId: 41, duplicateId: 43 },
  { keepId: 108, duplicateId: 80 },
  { keepId: 69, duplicateId: 68 },
  { keepId: 26, duplicateId: 25 },
];

export const RESOLVED_VALUES = {
  33: {
    address: '24/1 BONG SAO, BINH DONG WARD, HO CHI MINH CITY, VIETNAM',
    invoiceCompanyAddress:
      '24/1 BONG SAO, BINH DONG WARD, HO CHI MINH CITY, VIETNAM',
  },
  42: {
    address: 'INDUSTRIAL ZONE, AN BINH WARD, GIA LAI PROVINCE, VIETNAM',
    customerType: 'DIRECT',
    invoiceCompanyAddress:
      'INDUSTRIAL ZONE, AN BINH WARD, GIA LAI PROVINCE, VIETNAM',
  },
  109: {
    address: '30 CAM BAC 5 STREET, CAM LE WARD, DA NANG CITY, VIETNAM',
    invoiceCompanyName: 'PHUC THINH AGRICULTURAL MACHINERY COMPANY LIMITED',
    invoiceCompanyAddress:
      '30 CAM BAC 5 STREET, CAM LE WARD, DA NANG CITY, VIETNAM',
  },
  65: {},
  41: {
    address:
      '6 FL., NO. 3, ALLEY 35, LANE 118, WUXING ST., XINYI DISTRICT, TAIPEI CITY 110, TAIWAN',
    invoiceCompanyAddress:
      '6 FL., NO. 3, ALLEY 35, LANE 118, WUXING ST., XINYI DISTRICT, TAIPEI CITY 110, TAIWAN',
  },
  108: {
    address:
      'LOT A10, PHU TAI INDUSTRIAL ZONE, QUY NHON BAC WARD, GIA LAI PROVINCE, VIETNAM',
    invoiceCompanyName: 'TRUONG HUY CO., LTD',
    invoiceCompanyAddress:
      'LOT A10, PHU TAI INDUSTRIAL ZONE, QUY NHON BAC WARD, GIA LAI PROVINCE, VIETNAM',
  },
  69: {
    address: 'VITSHOEKSTRAAT 11, 2070 ZWIJNDRECHT, BELGIUM',
    invoiceCompanyAddress: 'VITSHOEKSTRAAT 11, 2070 ZWIJNDRECHT, BELGIUM',
  },
  26: {
    country: 'VIETNAM',
    city: 'Ho Chi Minh',
    address: 'NO. 31 TRAN KHAC CHAN, TAN DINH WARD, HO CHI MINH CITY, VIETNAM',
    customerStatus: 'WINCLIENT',
    customerType: 'DIRECT',
    invoiceCompanyAddress:
      'NO. 31 TRAN KHAC CHAN, TAN DINH WARD, HO CHI MINH CITY, VIETNAM',
  },
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
  for (const field of fields) {
    if (blank(keep[field]) && !blank(duplicate[field])) {
      keep[field] = duplicate[field];
    }
  }
  const contacts = [...(keep.contacts ?? []), ...(duplicate.contacts ?? [])];
  keep.contacts = [
    ...new Map(
      contacts.map((contact) => [
        JSON.stringify(canonicalize(contact)),
        contact,
      ]),
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
    throw new Error('Remaining partner dedupe IDs must be unique');
  }
  for (const keepId of keepIds) {
    if (!RESOLVED_VALUES[keepId]) {
      throw new Error(`Missing resolved values for keeper ${keepId}`);
    }
  }
  return { keepIds, duplicateIds, allIds };
}
