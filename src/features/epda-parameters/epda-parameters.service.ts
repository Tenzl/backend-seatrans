import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EpdaParameterSet,
  EpdaParameterValues,
  PartialEpdaParameterValues,
} from './entities/epda-parameter-set.entity';
import {
  EpdaParameterChangeAction,
  EpdaParameterChangeLog,
} from './entities/epda-parameter-change-log.entity';
import { Port } from '../ports/entities/port.entity';

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

/**
 * Built-in fallback defaults (mirror the FE quoteParameters defaults + the seed)
 * so the form always resolves even when no DB row exists. MIDDLE = QN template;
 * NORTHERN / SOUTHERN = HCM template.
 */
export function defaultValuesForArea(area?: string | null): EpdaParameterValues {
  const isQn = (area ?? '').toUpperCase() === 'MIDDLE';
  const base: EpdaParameterValues = {
    hours: { berthHours: 96, anchorageHours: 24, pilotageThirdMiles: 17, qnPilotageMiles: 5 },
    garbage: { atBerthUsd: 54, atBuoyUsd: 54, cbmAmount: 1 },
    quarantine: { shipUnitLowGrt: 95, shipUnitHighGrt: 110, shipThresholdGrt: 10000, cargoPerTrip: 100 },
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
    agencyFeeTiers: AGENCY_FEE_TIERS.map((t) => ({ ...t })),
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
      { minLoa: 205, amount: 2800, label: '205 - <225m' },
    ],
    // Empty by default: the EPDA calc falls back to the coeff bag/equip/bulk rates
    // until an admin adds explicit per-cargo-type rates on the Parameter screen.
    cargoAgencyRates: [],
  };
  if (!isQn) return base;
  return {
    ...base,
    garbage: { atBerthUsd: 17, atBuoyUsd: 17, cbmAmount: 1 },
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
      { minLoa: 0, amount: 1154, label: '80 - <90m' },
      { minLoa: 90, amount: 2308, label: '90 - <135m' },
      { minLoa: 135, amount: 3956, label: '135 - <175m' },
      { minLoa: 175, amount: 6792, label: '175 - <200m' },
      { minLoa: 200, amount: 9916, label: 'over DWT' },
    ],
  };
}

/** Deep-merge parameter value layers; later layers win. Arrays (tiers) replace. */
function mergeValues(
  area: string | null,
  ...layers: Array<PartialEpdaParameterValues | undefined | null>
): EpdaParameterValues {
  const out = defaultValuesForArea(area);
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.hours) out.hours = { ...out.hours, ...layer.hours };
    if (layer.garbage) out.garbage = { ...out.garbage, ...layer.garbage };
    if (layer.quarantine) out.quarantine = { ...out.quarantine, ...layer.quarantine };
    if (layer.coeff) out.coeff = { ...out.coeff, ...layer.coeff };
    if (Array.isArray(layer.agencyFeeTiers))
      out.agencyFeeTiers = layer.agencyFeeTiers.map((t) => ({ ...t }));
    if (Array.isArray(layer.moorUnmoorBerthTiers))
      out.moorUnmoorBerthTiers = layer.moorUnmoorBerthTiers.map((t) => ({ ...t }));
    if (Array.isArray(layer.moorUnmoorBuoyTiers))
      out.moorUnmoorBuoyTiers = layer.moorUnmoorBuoyTiers.map((t) => ({ ...t }));
    if (Array.isArray(layer.tugTiers))
      out.tugTiers = layer.tugTiers.map((t) => ({ ...t }));
    if (Array.isArray(layer.cargoAgencyRates))
      out.cargoAgencyRates = layer.cargoAgencyRates.map((r) => ({ ...r }));
  }
  return out;
}

@Injectable()
export class EpdaParametersService {
  constructor(
    @InjectRepository(EpdaParameterSet)
    private readonly repo: Repository<EpdaParameterSet>,
    @InjectRepository(EpdaParameterChangeLog)
    private readonly logRepo: Repository<EpdaParameterChangeLog>,
    @InjectRepository(Port)
    private readonly portRepo: Repository<Port>,
  ) {}

  /** Record an edit on the Parameter screen (best-effort; never blocks the write). */
  private async logChange(entry: {
    scope: 'AREA' | 'PORT';
    area: string | null;
    portId: number | null;
    action: EpdaParameterChangeAction;
    changedByUserId: number | null;
    beforeValues: PartialEpdaParameterValues | null;
    afterValues: PartialEpdaParameterValues | null;
  }): Promise<void> {
    try {
      await this.logRepo.save(this.logRepo.create(entry));
    } catch {
      // Audit logging must not break the parameter save.
    }
  }

  listAll(): Promise<EpdaParameterSet[]> {
    return this.repo.find({ order: { scope: 'ASC', area: 'ASC', portId: 'ASC' } });
  }

  getAreaSet(area: string): Promise<EpdaParameterSet | null> {
    return this.repo.findOne({ where: { scope: 'AREA', area } });
  }

  getPortOverride(portId: number): Promise<EpdaParameterSet | null> {
    return this.repo.findOne({ where: { scope: 'PORT', portId } });
  }

  async upsertArea(
    area: string,
    values: PartialEpdaParameterValues,
    actorUserId?: number,
  ): Promise<EpdaParameterSet> {
    const existing = await this.getAreaSet(area);
    const before = existing ? existing.values : null;
    const saved = existing
      ? await this.repo.save(
          Object.assign(existing, { values: mergeValues(area, existing.values, values) }),
        )
      : await this.repo.save(
          this.repo.create({ scope: 'AREA', area, portId: null, values: mergeValues(area, values) }),
        );
    await this.logChange({
      scope: 'AREA',
      area,
      portId: null,
      action: 'UPSERT_AREA',
      changedByUserId: actorUserId ?? null,
      beforeValues: before,
      afterValues: saved.values,
    });
    return saved;
  }

  private async resolvePortArea(portId: number): Promise<string | null> {
    const port = await this.portRepo.findOne({
      where: { id: portId },
      relations: { province: true },
    });
    if (!port) throw new NotFoundException(`Port ${portId} not found`);
    return port.province?.area ?? null;
  }

  async upsertPort(
    portId: number,
    values: PartialEpdaParameterValues,
    actorUserId?: number,
  ): Promise<EpdaParameterSet> {
    const area = await this.resolvePortArea(portId);
    const existing = await this.getPortOverride(portId);
    const before = existing ? existing.values : null;
    const saved = existing
      ? await this.repo.save(
          Object.assign(existing, { area, values: { ...existing.values, ...values } }),
        )
      : await this.repo.save(this.repo.create({ scope: 'PORT', area, portId, values }));
    await this.logChange({
      scope: 'PORT',
      area,
      portId,
      action: 'UPSERT_PORT',
      changedByUserId: actorUserId ?? null,
      beforeValues: before,
      afterValues: saved.values,
    });
    return saved;
  }

  async deletePort(portId: number, actorUserId?: number): Promise<void> {
    const existing = await this.getPortOverride(portId);
    await this.repo.delete({ scope: 'PORT', portId });
    await this.logChange({
      scope: 'PORT',
      area: existing?.area ?? null,
      portId,
      action: 'DELETE_PORT',
      changedByUserId: actorUserId ?? null,
      beforeValues: existing ? existing.values : null,
      afterValues: null,
    });
  }

  /** Recent Parameter-screen edits, filtered by port (preferred) or area. */
  async listChangeLogs(opts: { area?: string; portId?: number; limit?: number }) {
    const where: Record<string, unknown> = {};
    if (opts.portId != null) where.portId = opts.portId;
    else if (opts.area) where.area = opts.area;

    const rows = await this.logRepo.find({
      where,
      relations: { changedBy: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: Math.min(100, Math.max(1, opts.limit ?? 50)),
    });

    return rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      area: r.area,
      portId: r.portId,
      action: r.action,
      createdAt: r.createdAt.toISOString(),
      changedBy: {
        id: r.changedByUserId,
        fullName: r.changedBy?.fullName ?? null,
        email: r.changedBy?.email ?? null,
      },
      beforeValues: r.beforeValues,
      afterValues: r.afterValues,
    }));
  }

  /** Resolved values used by the EPDA form: area set overlaid with port override. */
  async getEffective(
    area: string,
    portId?: number,
  ): Promise<EpdaParameterValues> {
    const areaSet = area ? await this.getAreaSet(area) : null;
    const portSet = portId ? await this.getPortOverride(portId) : null;
    return mergeValues(area, areaSet?.values, portSet?.values);
  }
}
