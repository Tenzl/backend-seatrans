import { containerRowHasCargo } from './an-container';
import { BookingDocumentType } from './enums/booking-document-type.enum';
import { parseReportNumber } from './booking-document-relational-projector';

export const REQUIRED_TEXT_FIELDS: Record<BookingDocumentType, string[]> = {
  [BookingDocumentType.BOOKING_CONFIRMATION]: [
    'bookingNumber',
    'date',
    'to',
    'vesselVoyage',
    'etd',
    'eta',
    'portOfLoading',
    'portOfDischarge',
    'commodityType',
    'commodityName',
    'grossWeight',
    'measurement',
    'pic',
  ],
  [BookingDocumentType.BILL_OF_LADING]: [
    'fblNumber',
    'consignor',
    'consignedToOrderOf',
    'oceanVessel',
    'portOfLoading',
    'portOfDischarge',
    'serviceMode',
    'shippingMark',
    'descriptionOfGoods',
    'placeOfIssue',
    'dateOfIssue',
    'numberOfOriginals',
  ],
  [BookingDocumentType.ARRIVAL_NOTICE]: [
    'anNumber',
    'date',
    'agent',
    'shipper',
    'consignee',
    'hblNumber',
    'vesselVoyage',
    'eta',
    'portOfLoading',
    'portOfDischarge',
    'serviceMode',
    'descriptionOfGoods',
  ],
  [BookingDocumentType.DELIVERY_ORDER]: [
    'doNumber',
    'date',
    'to',
    'deliverTo',
    'hblNumber',
    'vesselVoyage',
    'eta',
    'portOfLoading',
    'portOfDischarge',
    'serviceMode',
    'descriptionOfGoods',
  ],
};

export const REQUIRED_CONTAINER_FIELDS = [
  'type',
  'containerNo',
  'sealNo',
  'grossWeight',
  'measurement',
  'noOfPkgs',
  'packageType',
] as const;

const POSITIVE_NUMBER_FIELDS = new Set<string>([
  'grossWeight',
  'measurement',
  'noOfPkgs',
]);

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasPositiveNumber(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value !== 'string' || !value.trim()) return false;
  const { numeric } = parseReportNumber(value);
  return numeric !== null && Number(numeric) > 0;
}

/** Canonical required-field evaluation used for server-owned document status. */
export function missingRequiredDocumentFields(
  type: BookingDocumentType,
  payload: Record<string, unknown>,
): string[] {
  const missing = REQUIRED_TEXT_FIELDS[type].filter((field) => {
    const value = payload[field];
    return POSITIVE_NUMBER_FIELDS.has(field)
      ? !hasPositiveNumber(value)
      : !hasText(value);
  });

  if (type === BookingDocumentType.BOOKING_CONFIRMATION) {
    const volumes = payload.cargoVolumes;
    const hasVolume =
      typeof volumes === 'object' &&
      volumes !== null &&
      Object.values(volumes).some(
        (value) => typeof value === 'number' && value > 0,
      );
    if (!hasVolume) missing.push('cargoVolumes');
    return missing;
  }

  const rows = Array.isArray(payload.containers)
    ? payload.containers.filter((row) => containerRowHasCargo(row as never))
    : [];
  if (rows.length === 0) {
    missing.push('containers');
    return missing;
  }

  rows.forEach((raw, index) => {
    const row = raw as Record<string, unknown>;
    for (const field of REQUIRED_CONTAINER_FIELDS) {
      const valid = POSITIVE_NUMBER_FIELDS.has(field)
        ? hasPositiveNumber(row[field])
        : hasText(row[field]);
      if (!valid) missing.push(`containers[${index}].${field}`);
    }
  });
  return missing;
}
