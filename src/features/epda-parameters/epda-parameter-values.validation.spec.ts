import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpsertEpdaParameterSetDto } from './dto/upsert-epda-parameter-set.dto';
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

  it('accepts authoritative Type ID cargo rates with a historical name snapshot', () => {
    expect(() =>
      validateEpdaParameterValues({
        cargoAgencyRates: [
          {
            commodityTypeId: 101,
            typeNameSnapshot: 'Project and breakbulk cargo',
            label: 'Cargo agency fee',
            rate: 0.05,
          },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects duplicate cargo rates by authoritative Type ID', () => {
    expect(() =>
      validateEpdaParameterValues({
        cargoAgencyRates: [
          {
            commodityTypeId: 101,
            typeNameSnapshot: 'Bulk',
            label: 'Bulk',
            rate: 0.05,
          },
          {
            commodityTypeId: 101,
            typeNameSnapshot: 'Renamed bulk',
            label: 'Bulk duplicate',
            rate: 0.06,
          },
        ],
      }),
    ).toThrow('duplicate commodityTypeId 101');
  });

  it.each([
    { commodityTypeId: 0, typeNameSnapshot: 'Bulk' },
    { commodityTypeId: 1.5, typeNameSnapshot: 'Bulk' },
    { commodityTypeId: 101, typeNameSnapshot: '   ' },
  ])('rejects invalid Type identity rate metadata: %p', (identity) => {
    expect(() =>
      validateEpdaParameterValues({
        cargoAgencyRates: [
          {
            ...identity,
            label: 'Bulk',
            rate: 0.05,
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a new legacy code-only cargo rate write', () => {
    expect(() =>
      validateEpdaParameterValues({
        cargoAgencyRates: [{ code: 'IN_BULK', label: 'Bulk', rate: 0.05 }],
      }),
    ).toThrow('commodityTypeId must be a positive integer');
  });

  it('rejects oversized JSONB payloads', () => {
    expect(() =>
      validateEpdaParameterValues({
        hours: {
          berthHours: 1,
        },
        cargoAgencyRates: [
          {
            commodityTypeId: 101,
            typeNameSnapshot: 'Bulk',
            label: 'x'.repeat(300_000),
            rate: 1,
          },
        ],
      }),
    ).toThrow('must not exceed');
  });
});

describe('EPDA cargo rate write DTO boundary', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it('accepts Type ID and name snapshot writes', async () => {
    await expect(
      pipe.transform(
        {
          values: {
            cargoAgencyRates: [
              {
                commodityTypeId: 101,
                typeNameSnapshot: 'Bulk',
                label: 'Bulk',
                rate: 0.05,
              },
            ],
          },
        },
        { type: 'body', metatype: UpsertEpdaParameterSetDto },
      ),
    ).resolves.toBeInstanceOf(UpsertEpdaParameterSetDto);
  });

  it('rejects code-only legacy keys on new writes', async () => {
    await expect(
      pipe.transform(
        {
          values: {
            cargoAgencyRates: [{ code: 'IN_BULK', label: 'Bulk', rate: 0.05 }],
          },
        },
        { type: 'body', metatype: UpsertEpdaParameterSetDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
