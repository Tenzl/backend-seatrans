import { ServiceInquiry } from '../entities/service-inquiry.entity';

export const CUSTOMER_SNAPSHOT_FIELD_KEYS = [
  'toShipowner',
  'mv',
  'dwt',
  'grt',
  'loa',
  'eta',
  'cargoQty',
  'cargoType',
  'cargoName',
  'port',
  'dischargeLoadingLocation',
  'frtTaxType',
  'purposeOfCalling',
] as const;

export type CustomerSnapshotFieldKey = (typeof CUSTOMER_SNAPSHOT_FIELD_KEYS)[number];

export type CustomerSubmittedSnapshot = Record<CustomerSnapshotFieldKey, string>;

function normalize(value: string | number | null | undefined): string {
  if (value == null) return '';
  return String(value).trim().replace(/\s+/g, ' ');
}

export function originalValueFromSnapshot(
  snapshot: Record<string, string> | null | undefined,
  fieldName: string,
): string | null {
  if (!snapshot || !(fieldName in snapshot)) return null;
  return snapshot[fieldName as CustomerSnapshotFieldKey] || null;
}

export function buildCustomerSubmittedSnapshot(
  source: Pick<
    ServiceInquiry,
    | 'toName'
    | 'mv'
    | 'dwt'
    | 'grt'
    | 'loa'
    | 'eta'
    | 'cargoQuantity'
    | 'cargoType'
    | 'cargoName'
    | 'cargoNameOther'
    | 'portOfCall'
    | 'dischargeLoadingLocation'
    | 'frtTaxType'
    | 'purposeOfCalling'
  >,
): CustomerSubmittedSnapshot {
  return {
    toShipowner: normalize(source.toName),
    mv: normalize(source.mv),
    dwt: normalize(source.dwt),
    grt: normalize(source.grt),
    loa: normalize(source.loa),
    eta: normalize(source.eta),
    cargoQty: normalize(source.cargoQuantity),
    cargoType: normalize(source.cargoType),
    cargoName: normalize(source.cargoName ?? source.cargoNameOther),
    port: normalize(source.portOfCall),
    dischargeLoadingLocation: normalize(source.dischargeLoadingLocation),
    frtTaxType: normalize(source.frtTaxType),
    purposeOfCalling: normalize(source.purposeOfCalling),
  };
}
