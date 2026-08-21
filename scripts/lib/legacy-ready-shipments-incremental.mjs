import { createHash } from 'node:crypto';
import {
  canonicalReadyPayload,
  validateReadyRecords,
} from './legacy-ready-shipments-migration.mjs';

export const MIGRATION_ID =
  '2026-08-20_legacy_ready_shipments_after_partner_dedupe_v2';
export const APPLY_CONFIRMATION =
  'APPLY_LEGACY_READY_SHIPMENTS_INCREMENTAL_20260820';
export const SIMULATE_CONFIRMATION =
  'SIMULATE_LEGACY_READY_SHIPMENTS_INCREMENTAL_20260820';
export const EXPECTED_INCREMENTAL_COUNT = 171;

export function selectNewlyReadyRecords(currentInput, baselineInput) {
  if (!Array.isArray(currentInput?.records)) {
    throw new Error('Current input must contain a records array');
  }
  if (!Array.isArray(baselineInput?.records)) {
    throw new Error('Baseline input must contain a records array');
  }
  const baselineByShipmentId = new Map(
    baselineInput.records.map((record) => [
      record.shipmentId,
      record.classification,
    ]),
  );
  return currentInput.records.filter(
    (record) =>
      record.classification === 'READY' &&
      baselineByShipmentId.get(record.shipmentId) === 'NEEDS_REVIEW',
  );
}

export function validateIncrementalRecords(records, appliedShipmentIds = []) {
  if (records.length !== EXPECTED_INCREMENTAL_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_INCREMENTAL_COUNT} newly READY records, received ${records.length}`,
    );
  }
  const validation = validateReadyRecords(records);
  const overlap = records
    .map((record) => record.shipmentId)
    .filter((shipmentId) => appliedShipmentIds.includes(shipmentId));
  if (overlap.length) {
    throw new Error(
      `Incremental records overlap the first migration: ${overlap.join(', ')}`,
    );
  }
  return validation;
}

export function checksumIncrementalRecords(records) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalReadyPayload(records)))
    .digest('hex');
}

export function checksumProtectedRows(rows) {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
