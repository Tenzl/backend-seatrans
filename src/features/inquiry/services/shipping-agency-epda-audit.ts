import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';

export interface EpdaFieldChange {
  field: string;
  previousValue: string | null;
  newValue: string | null;
}

export function epdaFieldSnapshot(
  row: ShippingAgencyInquiryEntity,
): Record<string, string | null> {
  const stringValue = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    let serialized: string;
    if (typeof value === 'string') serialized = value;
    else if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      serialized = value.toString();
    } else if (typeof value === 'object') {
      serialized = JSON.stringify(value);
    } else {
      return null;
    }
    const normalized = serialized.trim();
    return normalized.length ? normalized : null;
  };

  // Compare/display numeric fields by value, not raw DB text. PostgreSQL
  // numeric values such as "54.0000" and "54" must not create false changes.
  const numericValue = (value: unknown): string | null => {
    const normalized = stringValue(value);
    if (normalized === null) return null;
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? String(numeric) : normalized;
  };

  return {
    'Ship owner': stringValue(row.toName),
    Vessel: stringValue(row.mv),
    GRT: numericValue(row.grt),
    DWT: numericValue(row.dwt),
    LOA: numericValue(row.loa),
    ETA: stringValue(row.eta),
    'Cargo type': stringValue(row.cargoType),
    'Cargo name': stringValue(row.cargoName),
    'Cargo name (other)': stringValue(row.cargoNameOther),
    Quantity: numericValue(row.cargoQuantity),
    'Freight tax type': stringValue(row.frtTaxType),
    'Purpose of calling': stringValue(row.purposeOfCalling),
    'Port of call': stringValue(row.portOfCall),
    'Discharge/loading at': stringValue(row.dischargeLoadingLocation),
    'Quote form': stringValue(row.quoteForm),
    'Berth hours': numericValue(row.berthHours),
    'Anchorage hours': numericValue(row.anchorageHours),
    'Pilotage miles': numericValue(row.pilotage3rdMiles),
    'Document date': stringValue(row.epdaDocumentDate),
    'Ship type': stringValue(row.shipType),
    'Shipowner nationality': stringValue(row.shipownerNationality),
    'Ocean freight rate': numericValue(row.oceanFrtRateUsdPerMt),
    'Garbage USD rate': numericValue(row.garbageUsdRate),
    'Quarantine cargo mode': stringValue(row.quarantineCargoMode),
    'Agency fee mode': stringValue(row.agencyFeeMode),
    'Agency discount %': numericValue(row.agencyDiscountPercent),
    'Agency lumpsum': numericValue(row.agencyLumpsumAmount),
    'Boat hire (agency)': numericValue(row.boatHireAmount),
    'Tally fee': numericValue(row.tallyFeeAmount),
    'Tug assistance': numericValue(row.tugAssistanceAmount),
    'Tug assistance trips':
      row.tugAssistanceTrips == null ? null : String(row.tugAssistanceTrips),
    'Shorecrane-hire USD/mt': numericValue(row.shorecraneHireUsdPerMt),
    'Transport (taxi/courier)': stringValue(row.transportLs),
    'Boat hire (quarantine)': numericValue(row.transportQuarantine),
  };
}

export function diffEpdaFieldSnapshots(
  before: Record<string, string | null>,
  after: Record<string, string | null>,
): EpdaFieldChange[] {
  const changes: EpdaFieldChange[] = [];
  for (const field of Object.keys(after)) {
    const previousValue = before[field] ?? null;
    const newValue = after[field] ?? null;
    if (previousValue !== newValue) {
      changes.push({ field, previousValue, newValue });
    }
  }
  return changes;
}
