import { BadRequestException } from '@nestjs/common';
import {
  type GrtTier,
  type LoaTier,
  type PartialEpdaParameterValues,
} from './entities/epda-parameter-set.entity';

const MAX_TIER_ROWS = 200;
const MAX_VALUES_BYTES = 256 * 1024;
const RATIO_KEYS = new Set(['tankerFactor', 'bulkFactor', 'oceanFrtTaxRate']);

function fail(message: string): never {
  throw new BadRequestException(message);
}

function assertFiniteNonNegative(value: number, path: string): void {
  if (!Number.isFinite(value) || value < 0) {
    fail(`${path} must be a finite non-negative number`);
  }
}

function validateObjectNumbers(
  value: Record<string, number> | undefined,
  path: string,
): void {
  if (!value) return;
  for (const [key, entry] of Object.entries(value)) {
    // class-transformer materializes optional DTO class fields as enumerable
    // properties with value `undefined`; omitted partial fields must stay omitted.
    if (entry === undefined) continue;
    assertFiniteNonNegative(entry, `${path}.${key}`);
    if (RATIO_KEYS.has(key) && entry > 1) {
      fail(`${path}.${key} must be between 0 and 1`);
    }
  }
}

function validateLabel(label: string, path: string): void {
  if (!label.trim() || label.length > 100) {
    fail(`${path}.label must contain between 1 and 100 characters`);
  }
}

function validateGrtTiers(tiers: GrtTier[] | undefined, path: string): void {
  if (!tiers) return;
  if (tiers.length > MAX_TIER_ROWS) {
    fail(`${path} must contain at most ${MAX_TIER_ROWS} rows`);
  }

  let previousBoundary = -1;
  let openEndedCount = 0;
  tiers.forEach((tier, index) => {
    assertFiniteNonNegative(tier.amount, `${path}[${index}].amount`);
    validateLabel(tier.label, `${path}[${index}]`);
    if (tier.maxGrt === null) {
      openEndedCount += 1;
      if (index !== tiers.length - 1) {
        fail(`${path} open-ended tier must be the final row`);
      }
      return;
    }
    assertFiniteNonNegative(tier.maxGrt, `${path}[${index}].maxGrt`);
    if (tier.maxGrt <= previousBoundary) {
      fail(`${path} maxGrt boundaries must be strictly increasing`);
    }
    previousBoundary = tier.maxGrt;
  });
  if (openEndedCount > 1) {
    fail(`${path} may contain only one open-ended tier`);
  }
}

function validateLoaTiers(tiers: LoaTier[] | undefined): void {
  if (!tiers) return;
  if (tiers.length > MAX_TIER_ROWS) {
    fail(`tugTiers must contain at most ${MAX_TIER_ROWS} rows`);
  }

  let previousBoundary = -1;
  tiers.forEach((tier, index) => {
    assertFiniteNonNegative(tier.minLoa, `tugTiers[${index}].minLoa`);
    assertFiniteNonNegative(tier.amount, `tugTiers[${index}].amount`);
    validateLabel(tier.label, `tugTiers[${index}]`);
    if (tier.minLoa <= previousBoundary) {
      fail('tugTiers minLoa boundaries must be strictly increasing');
    }
    previousBoundary = tier.minLoa;
  });
}

export function validateEpdaParameterValues(
  values: PartialEpdaParameterValues,
): void {
  const serializedSize = Buffer.byteLength(JSON.stringify(values), 'utf8');
  if (serializedSize > MAX_VALUES_BYTES) {
    fail(`EPDA parameter values must not exceed ${MAX_VALUES_BYTES} bytes`);
  }
  // PS→port miles belong on the EPDA inquiry form, not parameter sets.
  if (values.hours) {
    const hours = values.hours as Record<string, unknown>;
    const { pilotageThirdMiles: _a, qnPilotageMiles: _b, ...rest } = hours;
    values.hours = rest as PartialEpdaParameterValues['hours'];
  }
  validateObjectNumbers(values.hours, 'hours');
  validateObjectNumbers(values.garbage, 'garbage');
  validateObjectNumbers(values.quarantine, 'quarantine');
  validateObjectNumbers(values.coeff, 'coeff');
  validateGrtTiers(values.agencyFeeTiers, 'agencyFeeTiers');
  validateGrtTiers(values.moorUnmoorBerthTiers, 'moorUnmoorBerthTiers');
  validateGrtTiers(values.moorUnmoorBuoyTiers, 'moorUnmoorBuoyTiers');
  validateLoaTiers(values.tugTiers);

  if (values.cargoAgencyRates) {
    if (values.cargoAgencyRates.length > MAX_TIER_ROWS) {
      fail(`cargoAgencyRates must contain at most ${MAX_TIER_ROWS} rows`);
    }
    const codes = new Set<string>();
    values.cargoAgencyRates.forEach((rate, index) => {
      const code = rate.code.trim().toUpperCase();
      if (!code || code.length > 50) {
        fail(
          `cargoAgencyRates[${index}].code must contain between 1 and 50 characters`,
        );
      }
      if (codes.has(code)) {
        fail(`cargoAgencyRates contains duplicate code ${code}`);
      }
      codes.add(code);
      validateLabel(rate.label, `cargoAgencyRates[${index}]`);
      assertFiniteNonNegative(rate.rate, `cargoAgencyRates[${index}].rate`);
    });
  }
}

export function isEmptyEpdaOverride(
  values: PartialEpdaParameterValues,
): boolean {
  return Object.entries(values).every(([, value]) => {
    if (Array.isArray(value)) return false;
    if (value && typeof value === 'object') {
      return Object.values(value).every((entry) => entry === undefined);
    }
    return value === undefined;
  });
}
