import { createHash } from 'node:crypto';

export const MIGRATION_ID =
  '2026-08-20_legacy_ready_bl_container_gross_weight_fix_v1';
export const SOURCE_MIGRATION_ID = '2026-08-20_legacy_ready_shipments_v1';
export const APPLY_CONFIRMATION =
  'APPLY_LEGACY_READY_BL_GROSS_WEIGHT_FIX_20260820';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sumNumeric(values) {
  const numbers = values
    .map((value) => Number(text(value)))
    .filter(Number.isFinite);
  return numbers.length
    ? String(numbers.reduce((sum, value) => sum + value, 0))
    : '';
}

export function buildBillGrossWeightCorrection(target) {
  const bookingGrossWeight = text(target.bookingPayload?.grossWeight);
  const payload = target.blPayload;
  const containers = payload?.containers;
  if (!Array.isArray(containers) || containers.length === 0) {
    throw new Error(`${target.shipmentId}: BL containers are required`);
  }

  const containerWeights = containers.map((container) =>
    text(container?.grossWeight),
  );
  const nonblankWeights = containerWeights.filter(Boolean);
  if (nonblankWeights.length === 0) {
    const migratedBlankTotal = sumNumeric(containerWeights);
    if (!text(payload.grossWeight)) {
      return { changed: false, payload };
    }
    if (text(payload.grossWeight) !== migratedBlankTotal) {
      throw new Error(
        `${target.shipmentId}: unexpected BL total while container weights are blank`,
      );
    }
    return {
      changed: true,
      payload: { ...payload, grossWeight: '' },
    };
  }
  if (!bookingGrossWeight) {
    throw new Error(
      `${target.shipmentId}: Booking gross weight is required for verification`,
    );
  }
  if (
    nonblankWeights.length !== containers.length ||
    nonblankWeights.some((weight) => weight !== bookingGrossWeight)
  ) {
    throw new Error(
      `${target.shipmentId}: container weight differs from the migrated Booking gross weight`,
    );
  }

  const expectedMigratedTotal = sumNumeric(containerWeights);
  if (text(payload.grossWeight) !== expectedMigratedTotal) {
    throw new Error(
      `${target.shipmentId}: unexpected migrated BL gross weight`,
    );
  }

  return {
    changed: true,
    payload: {
      ...payload,
      grossWeight: '',
      containers: containers.map((container) => ({
        ...container,
        grossWeight: '',
      })),
    },
  };
}

export function checksumCorrectionTargets(targets) {
  const canonical = targets
    .map((target) => ({
      shipmentId: target.shipmentId,
      bookingId: String(target.bookingId),
      billOfLadingId: String(target.billOfLadingId),
      bookingGrossWeight: target.bookingPayload?.grossWeight ?? '',
      blPayload: target.blPayload,
    }))
    .sort((left, right) => left.shipmentId.localeCompare(right.shipmentId));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
