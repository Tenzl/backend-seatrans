import { createHash } from 'node:crypto';

export const MIGRATION_ID = '2026-08-21_freightek_place_of_issue_backfill';
export const APPLY_CONFIRMATION =
  'APPLY_FREIGHTEK_PLACE_OF_ISSUE_BACKFILL_20260821';

function text(value) {
  return String(value ?? '').trim();
}

export function extractPlaceOfIssueEntries(document) {
  if (!Array.isArray(document?.entries)) {
    throw new Error('FreightEK input must contain an entries array');
  }
  const seenBookings = new Set();
  const seenShipments = new Set();
  return document.entries.map((entry, index) => {
    if (entry?.status !== 'success') {
      throw new Error(`Entry ${index + 1} is not successful`);
    }
    const bookingNo = text(entry.bookingNo);
    const shipmentId = text(entry.shipmentId);
    const hbl = text(entry.hbl);
    if (!bookingNo || !shipmentId || !hbl) {
      throw new Error(
        `Entry ${index + 1} is missing Booking No., Shipment ID, or HBL`,
      );
    }
    if (seenBookings.has(bookingNo) || seenShipments.has(shipmentId)) {
      throw new Error(`Duplicate Booking No. or Shipment ID: ${bookingNo}`);
    }
    seenBookings.add(bookingNo);
    seenShipments.add(shipmentId);

    const fields = (entry.pageSnapshot?.sections ?? []).flatMap(
      (section) => section?.fields ?? [],
    );
    const field = fields.find(
      (candidate) => text(candidate?.name) === 'B/L Place of issue',
    );
    if (!field) {
      throw new Error(`${shipmentId}: B/L Place of issue field is missing`);
    }
    const controls = Array.isArray(field.controls) ? field.controls : [];
    const placeOfIssue = text(
      controls.find((control) => control?.type === 'textarea')?.value,
    );
    const mode = text(
      controls.find((control) => control?.type === 'text')?.value,
    );
    if (placeOfIssue.length > 300) {
      throw new Error(
        `${shipmentId}: B/L Place of issue exceeds 300 characters`,
      );
    }
    return { bookingNo, shipmentId, hbl, mode, placeOfIssue };
  });
}

export function checksumPlaceOfIssueEntries(entries) {
  const canonical = [...entries]
    .sort((left, right) => left.bookingNo.localeCompare(right.bookingNo))
    .map(({ bookingNo, shipmentId, hbl, mode, placeOfIssue }) => ({
      bookingNo,
      shipmentId,
      hbl,
      mode,
      placeOfIssue,
    }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function buildPlaceOfIssuePlan(sources, databaseRows) {
  const byBooking = new Map();
  for (const row of databaseRows) {
    const bookingNumber = text(row.bookingNumber);
    const matches = byBooking.get(bookingNumber) ?? [];
    matches.push(row);
    byBooking.set(bookingNumber, matches);
  }

  const blockers = [];
  const updates = [];
  let blankSourceCount = 0;
  for (const source of sources) {
    const matches = byBooking.get(source.bookingNo) ?? [];
    const bookingIds = [...new Set(matches.map((row) => text(row.bookingId)))];
    if (bookingIds.length !== 1) {
      blockers.push({
        code: bookingIds.length === 0 ? 'MISSING_BOOKING' : 'DUPLICATE_BOOKING',
        bookingNo: source.bookingNo,
        bookingIds,
      });
      continue;
    }
    const bills = matches.filter((row) => text(row.billId));
    if (bills.length !== 1) {
      blockers.push({
        code: bills.length === 0 ? 'MISSING_BILL' : 'MULTIPLE_BILLS',
        bookingNo: source.bookingNo,
        billIds: bills.map((row) => text(row.billId)),
      });
      continue;
    }
    const row = bills[0];
    if (text(row.fblNumber) !== source.hbl) {
      blockers.push({
        code: 'HBL_MISMATCH',
        bookingNo: source.bookingNo,
        sourceHbl: source.hbl,
        databaseHbl: text(row.fblNumber),
      });
      continue;
    }
    if (!source.placeOfIssue) {
      blankSourceCount += 1;
      continue;
    }
    const bookingValue = text(row.bookingPayload?.placeOfIssue);
    const billValue = text(row.billPayload?.placeOfIssue);
    if (bookingValue && bookingValue !== source.placeOfIssue) {
      blockers.push({
        code: 'BOOKING_VALUE_CONFLICT',
        bookingNo: source.bookingNo,
        sourceValue: source.placeOfIssue,
        databaseValue: bookingValue,
      });
      continue;
    }
    if (billValue && billValue !== source.placeOfIssue) {
      blockers.push({
        code: 'BILL_VALUE_CONFLICT',
        bookingNo: source.bookingNo,
        sourceValue: source.placeOfIssue,
        databaseValue: billValue,
      });
      continue;
    }
    updates.push({
      bookingId: text(row.bookingId),
      billId: text(row.billId),
      bookingNumber: source.bookingNo,
      shipmentId: source.shipmentId,
      fblNumber: source.hbl,
      placeOfIssue: source.placeOfIssue,
    });
  }
  return { blockers, updates, blankSourceCount };
}
