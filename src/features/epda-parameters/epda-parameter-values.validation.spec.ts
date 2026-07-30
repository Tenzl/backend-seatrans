import { BadRequestException } from '@nestjs/common';
import {
  isEmptyEpdaOverride,
  validateEpdaParameterValues,
} from './epda-parameter-values.validation';

describe('validateEpdaParameterValues', () => {
  it('accepts finite decimal coefficients', () => {
    expect(() =>
      validateEpdaParameterValues({
        coeff: { tonnagePerGrt: 0.034, pilotageSingleRate: 0.005 },
      }),
    ).not.toThrow();
  });

  it('ignores optional DTO fields materialized as undefined', () => {
    expect(() =>
      validateEpdaParameterValues({
        coeff: {
          tonnagePerGrt: undefined as unknown as number,
          navigationPerGrt: undefined as unknown as number,
          clearanceFee: 150,
          pilotageMinAmount: 700,
        },
      }),
    ).not.toThrow();
  });

  it('rejects null numeric values that slipped through optional DTO fields', () => {
    expect(() =>
      validateEpdaParameterValues({
        coeff: { tonnagePerGrt: null as unknown as number },
      }),
    ).toThrow('coeff.tonnagePerGrt must be a finite non-negative number');
  });

  it('treats an object containing only undefined DTO fields as empty', () => {
    expect(
      isEmptyEpdaOverride({
        coeff: {
          tonnagePerGrt: undefined as unknown as number,
        },
      }),
    ).toBe(true);
  });

  it('rejects negative parameter values', () => {
    expect(() =>
      validateEpdaParameterValues({
        coeff: { clearanceFee: -1 },
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects factors outside the 0..1 range', () => {
    expect(() =>
      validateEpdaParameterValues({
        coeff: { tankerFactor: 1.1 },
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects unordered and repeated GRT tier boundaries', () => {
    expect(() =>
      validateEpdaParameterValues({
        agencyFeeTiers: [
          { maxGrt: 5000, amount: 100, label: 'First' },
          { maxGrt: 5000, amount: 200, label: 'Duplicate' },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('allows an empty array because it explicitly replaces an inherited tier list', () => {
    expect(() =>
      validateEpdaParameterValues({
        moorUnmoorBuoyTiers: [],
      }),
    ).not.toThrow();
  });

  it('rejects duplicate cargo codes case-insensitively', () => {
    expect(() =>
      validateEpdaParameterValues({
        cargoAgencyRates: [
          { code: 'IN_BULK', label: 'Bulk', rate: 0.05 },
          { code: 'in_bulk', label: 'Bulk duplicate', rate: 0.06 },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects oversized JSONB payloads', () => {
    expect(() =>
      validateEpdaParameterValues({
        hours: {
          berthHours: 1,
        },
        cargoAgencyRates: [
          {
            code: 'OVERSIZED',
            label: 'x'.repeat(300_000),
            rate: 1,
          },
        ],
      }),
    ).toThrow('must not exceed');
  });
});
