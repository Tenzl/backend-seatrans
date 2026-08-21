import { createHash } from 'node:crypto';

export const MIGRATION_ID = '2026-08-20_legacy_ready_shipments_v1';
export const APPLY_CONFIRMATION = 'APPLY_LEGACY_READY_SHIPMENTS_20260820';

export function selectReadyRecords(input) {
  if (!input || !Array.isArray(input.records)) {
    throw new Error('Input must contain a records array');
  }
  return input.records.filter((record) => record.classification === 'READY');
}

export function canonicalReadyPayload(records) {
  return records
    .map((record) => ({
      shipmentId: record.shipmentId,
      bookingNormalized: record.bookingNormalized,
      createdByUserId: record.createdByUserId,
      createdAt: record.createdAt,
      bookingPayload: record.bookingPayload,
      blPayload: record.blPayload,
      sourceChecksum: record.sourceChecksum,
    }))
    .sort((left, right) => left.shipmentId.localeCompare(right.shipmentId));
}

export function checksumReadyRecords(records) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalReadyPayload(records)))
    .digest('hex');
}

export function validateReadyRecords(records) {
  if (records.length === 0) throw new Error('No READY records found');
  const shipmentIds = new Set();
  const bookingNumbers = new Set();
  const hblNumbers = new Set();
  for (const record of records) {
    if (record.flow !== 'EXPORT') {
      throw new Error(`${record.shipmentId}: READY record must be EXPORT`);
    }
    if (!record.shipmentId || shipmentIds.has(record.shipmentId)) {
      throw new Error(`Duplicate or missing Shipment ID: ${record.shipmentId}`);
    }
    shipmentIds.add(record.shipmentId);
    const bookingNumber = record.bookingPayload?.bookingNumber?.trim();
    if (
      !bookingNumber ||
      bookingNumber.length > 200 ||
      bookingNumbers.has(bookingNumber)
    ) {
      throw new Error(`${record.shipmentId}: invalid or duplicate Booking No.`);
    }
    bookingNumbers.add(bookingNumber);
    const hblNumber = record.blPayload?.fblNumber?.trim();
    if (!hblNumber || hblNumber.length > 100 || hblNumbers.has(hblNumber)) {
      throw new Error(`${record.shipmentId}: invalid or duplicate HBL/FBL No.`);
    }
    hblNumbers.add(hblNumber);
    if (
      !Number.isInteger(record.createdByUserId) ||
      record.createdByUserId <= 0
    ) {
      throw new Error(`${record.shipmentId}: invalid createdByUserId`);
    }
    if (
      record.bookingPayload?.commodityTypeId !== 177 ||
      record.bookingPayload?.commodityId !== 39
    ) {
      throw new Error(
        `${record.shipmentId}: unexpected Type/Commodity identity`,
      );
    }
    if (
      !Array.isArray(record.blPayload?.containers) ||
      record.blPayload.containers.length === 0
    ) {
      throw new Error(`${record.shipmentId}: BL containers are required`);
    }
  }
  return {
    readyCount: records.length,
    bookingNumbers: [...bookingNumbers],
    hblNumbers: [...hblNumbers],
    shipmentIds: [...shipmentIds],
  };
}

export function toCreatedAt(value) {
  const normalized = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) {
    throw new Error(`Invalid createdAt: ${normalized}`);
  }
  return `${normalized}:00+07:00`;
}
