import type { Province } from '../provinces/entities/province.entity';
import type { Port } from './entities/port.entity';
import {
  normalizePortName,
  normalizePortOfCall,
  normalizeProvinceId,
  toPortDto,
} from './port-normalization';

describe('port normalization', () => {
  it('normalizes display names and explicit port-of-call values', () => {
    expect(normalizePortName('  Cai   Mep  ')).toBe('Cai Mep');
    expect(normalizePortOfCall('  cai   mep terminal ', 'Ignored')).toBe(
      'CAI MEP TERMINAL',
    );
  });

  it('derives port of call by stripping terminal suffixes', () => {
    expect(normalizePortOfCall(undefined, 'Cai Mep Port Terminal')).toBe(
      'CAI MEP',
    );
    expect(normalizePortOfCall(undefined, 'Port')).toBe('PORT');
  });

  it('maps legacy non-positive province ids to no province', () => {
    expect(normalizeProvinceId(undefined)).toBeNull();
    expect(normalizeProvinceId(0)).toBeNull();
    expect(normalizeProvinceId(-1)).toBeNull();
    expect(normalizeProvinceId(7)).toBe(7);

    const dto = toPortDto(
      createPort({
        province: {
          id: 0,
          name: 'Legacy province',
          displayName: 'Legacy display',
          area: 2,
        } as Province,
      }),
    );

    expect(dto).toMatchObject({
      provinceId: null,
      provinceName: null,
      provinceArea: null,
    });
  });

  it('prefers province display name for valid relations', () => {
    const dto = toPortDto(
      createPort({
        province: {
          id: 4,
          name: 'Ba Ria - Vung Tau',
          displayName: 'Bà Rịa – Vũng Tàu',
          area: 1,
        } as Province,
      }),
    );

    expect(dto).toMatchObject({
      provinceId: 4,
      provinceName: 'Bà Rịa – Vũng Tàu',
      provinceArea: 1,
    });
  });
});

function createPort(overrides: Partial<Port> = {}): Port {
  return {
    id: 9,
    name: 'Cai Mep',
    portOfCall: 'CAI MEP',
    province: null,
    zoneCode: null,
    countryCode: 'VN',
    code: null,
    longitude: null,
    latitude: null,
    type: 'PORT',
    inCharge: false,
    isActive: true,
    hasInfo: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}
