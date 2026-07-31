import { BookingPartner } from '../entities/booking-partner.entity';

export interface PartnerFieldChange {
  field: string;
  previousValue: string | null;
  newValue: string | null;
}

export function partnerFieldSnapshot(
  row: BookingPartner,
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

  const numericValue = (value: unknown): string | null => {
    const normalized = stringValue(value);
    if (normalized === null) return null;
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? String(numeric) : normalized;
  };

  const additionTypes = (row.additionTypeRows ?? [])
    .map((item) => item.additionType)
    .filter(Boolean)
    .sort()
    .join(',');

  return {
    Name: stringValue(row.name),
    'Customer ID': stringValue(row.customerId),
    'Addition types': stringValue(additionTypes),
    Country: stringValue(row.country),
    City: stringValue(row.city),
    Contacts: stringValue(row.contacts ?? []),
    Phone: stringValue(row.phone),
    Fax: stringValue(row.fax),
    'Tracking URL': stringValue(row.trackingUrl),
    Address: stringValue(row.address),
    'Customer status': stringValue(row.customerStatus),
    'Customer type': stringValue(row.customerType),
    'Tax number': stringValue(row.taxNumber),
    'Approve status': stringValue(row.approveStatus),
    'Approve by': stringValue(row.approveBy),
    'Company establishment date': stringValue(row.companyEstablishmentDate),
    'Payment due days': numericValue(row.paymentDueDays),
    'Contract no': stringValue(row.contractNo),
    'Invoice company name': stringValue(row.invoiceCompanyName),
    'Invoice company address': stringValue(row.invoiceCompanyAddress),
    'Invoice company phone': stringValue(row.invoiceCompanyPhone),
    'Invoice company email': stringValue(row.invoiceCompanyEmail),
    'Invoice bank name': stringValue(row.invoiceBankName),
    'Invoice bank branch': stringValue(row.invoiceBankBranch),
    'Invoice bank account': stringValue(row.invoiceBankAccount),
  };
}

export function diffPartnerFieldSnapshots(
  before: Record<string, string | null>,
  after: Record<string, string | null>,
): PartnerFieldChange[] {
  const changes: PartnerFieldChange[] = [];
  for (const field of Object.keys(after)) {
    const previousValue = before[field] ?? null;
    const newValue = after[field] ?? null;
    if (previousValue !== newValue) {
      changes.push({ field, previousValue, newValue });
    }
  }
  return changes;
}
