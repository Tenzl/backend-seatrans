import { normalizeProvinceAreaCode } from '../provinces/province-area';
import type { Port } from '../ports/entities/port.entity';
import type { EpdaParameterGroupMember } from './entities/epda-parameter-group-member.entity';
import type {
  EpdaParameterSet,
  EpdaParameterValues,
  PartialEpdaParameterValues,
} from './entities/epda-parameter-set.entity';

export type EpdaAreaKey = '1' | '2' | '3';

const AGENCY_FEE_TIERS = [
  { maxGrt: 1000, amount: 0, label: '0 - 1,000' },
  { maxGrt: 3000, amount: 500, label: '1,001 - 3,000' },
  { maxGrt: 6000, amount: 600, label: '3,001 - 6,000' },
  { maxGrt: 10000, amount: 700, label: '6,001 - 10,000' },
  { maxGrt: 15000, amount: 850, label: '10,001 - 15,000' },
  { maxGrt: 25000, amount: 1000, label: '15,001 - 25,000' },
  { maxGrt: 50000, amount: 1150, label: '25,001 - 50,000' },
  { maxGrt: null, amount: 1300, label: '50,001+' },
];

export function normalizeEpdaAreaKey(
  value?: string | null,
): EpdaAreaKey | null {
  const normalized = value?.trim();
  return normalized === '1' || normalized === '2' || normalized === '3'
    ? normalized
    : null;
}

export function defaultValuesForArea(
  area?: string | null,
): EpdaParameterValues {
  const isQn = normalizeEpdaAreaKey(area) === '2';
  const base: EpdaParameterValues = {
    hours: {
      berthHours: 96,
      anchorageHours: 24,
    },
    garbage: { atBerthUsd: 54, atBuoyUsd: 54 },
    quarantine: {
      shipUnitLowGrt: 95,
      shipUnitHighGrt: 110,
      shipThresholdGrt: 10000,
      cargoPerTrip: 100,
    },
    coeff: {
      tonnagePerGrt: 0.034,
      navigationPerGrt: 0.1,
      tankerFactor: 0.85,
      bulkFactor: 1,
      berthDuePerGrtHour: 0.0031,
      buoyDuePerGrtHour: 0.0013,
      anchoragePerGrtHour: 0.0005,
      clearanceFee: 50,
      oceanFrtDefaultRate: 16,
      oceanFrtTaxRate: 0.02,
      pilotageLeg1Rate: 0.0034,
      pilotageLeg1Miles: 10,
      pilotageLeg2Rate: 0.0022,
      pilotageLeg2Miles: 20,
      pilotageLeg3Rate: 0.0015,
      pilotageSingleRate: 0.0034,
      pilotageMinAmount: 600,
      cargoAgencyBagRate: 0.06,
      cargoAgencyEquipRate: 0.1,
      cargoAgencyBulkRate: 0.05,
    },
    agencyFeeTiers: AGENCY_FEE_TIERS.map((tier) => ({ ...tier })),
    moorUnmoorBerthTiers: [
      { maxGrt: 4000, amount: 74, label: '<= 4,000' },
      { maxGrt: 9999, amount: 110, label: '4,001 - <10,000' },
      { maxGrt: 14999, amount: 144, label: '10,001 - <15,000' },
      { maxGrt: 19999, amount: 180, label: '15,001 - <20,000' },
      { maxGrt: null, amount: 220, label: '>= 20,001' },
    ],
    moorUnmoorBuoyTiers: [
      { maxGrt: 4000, amount: 180, label: '<= 4,000' },
      { maxGrt: 9999, amount: 240, label: '4,001 - <10,000' },
      { maxGrt: 14999, amount: 330, label: '10,001 - <15,000' },
      { maxGrt: 19999, amount: 380, label: '15,001 - <20,000' },
      { maxGrt: null, amount: 440, label: '>= 20,001' },
    ],
    tugTiers: [
      { minLoa: 80, amount: 510, label: '80 - <95m' },
      { minLoa: 95, amount: 1020, label: '95 - <120m' },
      { minLoa: 120, amount: 1490, label: '120 - <145m' },
      { minLoa: 145, amount: 1960, label: '145 - <160m' },
      { minLoa: 160, amount: 2180, label: '160 - <175m' },
      { minLoa: 175, amount: 2400, label: '175 - <190m' },
      { minLoa: 190, amount: 2600, label: '190 - <205m' },
      { minLoa: 205, amount: 2800, label: '≥ 205m' },
    ],
    cargoAgencyRates: [],
  };
  if (!isQn) return base;
  return {
    ...base,
    garbage: { atBerthUsd: 17, atBuoyUsd: 17 },
    coeff: { ...base.coeff, navigationPerGrt: 0.058, clearanceFee: 100 },
    moorUnmoorBerthTiers: [
      { maxGrt: 499, amount: 32, label: '< 500' },
      { maxGrt: 1000, amount: 50, label: '500 - <1,000' },
      { maxGrt: 4000, amount: 66, label: '1,001 - <4,000' },
      { maxGrt: 10000, amount: 120, label: '4,001 - <10,000' },
      { maxGrt: 15000, amount: 140, label: '10,001 - <15,000' },
      { maxGrt: null, amount: 180, label: '> 15,000' },
    ],
    moorUnmoorBuoyTiers: [],
    tugTiers: [
      { minLoa: 0, amount: 1154, label: '0 - <90m' },
      { minLoa: 90, amount: 2308, label: '90 - <135m' },
      { minLoa: 135, amount: 3956, label: '135 - <175m' },
      { minLoa: 175, amount: 6792, label: '175 - <200m' },
      { minLoa: 200, amount: 9916, label: '≥ 200m' },
    ],
  };
}

/** PS→port miles live on the EPDA form, not on tariff parameter sets. */
export function sanitizeEpdaHours(
  hours?:
    | (Partial<EpdaParameterValues['hours']> & Record<string, unknown>)
    | null,
): Partial<EpdaParameterValues['hours']> | undefined {
  if (!hours || typeof hours !== 'object') return undefined;
  const next: Partial<EpdaParameterValues['hours']> = {};
  if (hours.berthHours !== undefined) next.berthHours = Number(hours.berthHours);
  if (hours.anchorageHours !== undefined) {
    next.anchorageHours = Number(hours.anchorageHours);
  }
  return next;
}

/** Later layers win; nested objects merge while tier/rate arrays replace. */
export function resolveEpdaParameterValues(
  area: string | null,
  ...layers: Array<PartialEpdaParameterValues | undefined | null>
): EpdaParameterValues {
  const resolved = defaultValuesForArea(area);
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.hours) {
      resolved.hours = {
        ...resolved.hours,
        ...(sanitizeEpdaHours(layer.hours) ?? {}),
      };
    }
    if (layer.garbage)
      resolved.garbage = { ...resolved.garbage, ...layer.garbage };
    if (layer.quarantine) {
      resolved.quarantine = {
        ...resolved.quarantine,
        ...layer.quarantine,
      };
    }
    if (layer.coeff) resolved.coeff = { ...resolved.coeff, ...layer.coeff };
    if (Array.isArray(layer.agencyFeeTiers)) {
      resolved.agencyFeeTiers = layer.agencyFeeTiers.map((tier) => ({
        ...tier,
      }));
    }
    if (Array.isArray(layer.moorUnmoorBerthTiers)) {
      resolved.moorUnmoorBerthTiers = layer.moorUnmoorBerthTiers.map(
        (tier) => ({ ...tier }),
      );
    }
    if (Array.isArray(layer.moorUnmoorBuoyTiers)) {
      resolved.moorUnmoorBuoyTiers = layer.moorUnmoorBuoyTiers.map((tier) => ({
        ...tier,
      }));
    }
    if (Array.isArray(layer.tugTiers)) {
      resolved.tugTiers = layer.tugTiers.map((tier) => ({ ...tier }));
    }
    if (Array.isArray(layer.cargoAgencyRates)) {
      resolved.cargoAgencyRates = layer.cargoAgencyRates.map((rate) => ({
        ...rate,
      }));
    }
  }
  resolved.hours = {
    berthHours: resolved.hours.berthHours,
    anchorageHours: resolved.hours.anchorageHours,
  };
  return resolved;
}

export function cloneEpdaOverrideDocument(
  values: PartialEpdaParameterValues,
): PartialEpdaParameterValues {
  const clone = structuredClone(values);
  if (clone.hours) {
    const hours = sanitizeEpdaHours(clone.hours);
    if (hours && Object.keys(hours).length > 0) clone.hours = hours;
    else delete clone.hours;
  }
  return clone;
}

export function hydrateEpdaParameterRows(
  rows: EpdaParameterSet[],
  memberships: EpdaParameterGroupMember[],
  ports: Port[],
): EpdaParameterSet[] {
  const membersByGroup = new Map<number, number[]>();
  for (const membership of memberships) {
    const members = membersByGroup.get(membership.groupId) ?? [];
    members.push(membership.portId);
    membersByGroup.set(membership.groupId, members);
  }
  const areaByPort = new Map(
    ports.map((port) => {
      const area = normalizeProvinceAreaCode(port.province?.area ?? null);
      return [Number(port.id), area ? String(area) : null] as const;
    }),
  );

  return rows.map((row) => {
    if (row.scope === 'PORT' && row.portId != null) {
      row.portId = Number(row.portId);
      row.area = areaByPort.get(row.portId) ?? null;
    } else {
      row.area = normalizeEpdaAreaKey(row.area);
    }
    if (row.scope === 'GROUP') {
      // Normalized membership table is the only source; never fall back to JSONB.
      row.memberPortIds = (membersByGroup.get(row.id) ?? []).sort(
        (left, right) => left - right,
      );
    }
    return row;
  });
}
