import {
  cloneEpdaOverrideDocument,
  defaultValuesForArea,
  hydrateEpdaParameterRows,
  normalizeEpdaAreaKey,
  resolveEpdaParameterValues,
} from './epda-parameter-resolution';
import type { EpdaParameterGroupMember } from './entities/epda-parameter-group-member.entity';
import type { EpdaParameterSet } from './entities/epda-parameter-set.entity';
import type { Port } from '../ports/entities/port.entity';

describe('EPDA parameter resolution', () => {
  it('keeps the area-2 defaults distinct from areas 1 and 3', () => {
    expect(defaultValuesForArea('2')).toMatchObject({
      garbage: { atBerthUsd: 17, atBuoyUsd: 17 },
      coeff: { navigationPerGrt: 0.058, clearanceFee: 100 },
      moorUnmoorBuoyTiers: [],
    });
    expect(defaultValuesForArea('1')).toMatchObject({
      garbage: { atBerthUsd: 54, atBuoyUsd: 54 },
      coeff: { navigationPerGrt: 0.1, clearanceFee: 50 },
    });
  });

  it('merges nested values in AREA -> GROUP -> PORT order and replaces arrays', () => {
    const resolved = resolveEpdaParameterValues(
      '1',
      {
        hours: { berthHours: 72 },
        agencyFeeTiers: [{ maxGrt: null, amount: 10, label: 'Area' }],
      },
      { hours: { anchorageHours: 36 } },
      {
        hours: { berthHours: 48 },
        agencyFeeTiers: [{ maxGrt: null, amount: 20, label: 'Port' }],
      },
    );

    expect(resolved.hours).toMatchObject({
      berthHours: 48,
      anchorageHours: 36,
    });
    expect(resolved.agencyFeeTiers).toEqual([
      { maxGrt: null, amount: 20, label: 'Port' },
    ]);
  });

  it('returns detached arrays and override documents', () => {
    const layer = {
      tugTiers: [{ minLoa: 0, amount: 100, label: 'All' }],
    };
    const resolved = resolveEpdaParameterValues('1', layer);
    const clone = cloneEpdaOverrideDocument(layer);

    resolved.tugTiers[0].amount = 200;
    clone.tugTiers![0].amount = 300;

    expect(layer.tugTiers[0].amount).toBe(100);
  });

  it('hydrates normalized membership and derives PORT area without fallback drift', () => {
    const group = {
      id: 5,
      scope: 'GROUP',
      area: '1',
      memberPortIds: [99],
    } as EpdaParameterSet;
    const portOverride = {
      id: 6,
      scope: 'PORT',
      area: null,
      portId: 21,
    } as EpdaParameterSet;
    const memberships = [
      { groupId: 5, portId: 22 },
      { groupId: 5, portId: 21 },
    ] as EpdaParameterGroupMember[];
    const ports = [{ id: 21, province: { area: 2 } }] as unknown as Port[];

    hydrateEpdaParameterRows([group, portOverride], memberships, ports);

    expect(group.memberPortIds).toEqual([21, 22]);
    expect(portOverride.area).toBe('2');
  });

  it('accepts only canonical area keys', () => {
    expect(normalizeEpdaAreaKey(' 3 ')).toBe('3');
    expect(normalizeEpdaAreaKey('MIDDLE')).toBeNull();
  });
});
