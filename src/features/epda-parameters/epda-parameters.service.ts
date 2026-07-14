import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import {
  EpdaParameterScope,
  EpdaParameterSet,
  EpdaParameterValues,
  PartialEpdaParameterValues,
} from './entities/epda-parameter-set.entity';
import {
  EpdaParameterChangeAction,
  EpdaParameterChangeLog,
} from './entities/epda-parameter-change-log.entity';
import { Port } from '../ports/entities/port.entity';
import { normalizeProvinceAreaCode } from '../provinces/province-area';

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
 * so the form always resolves even when no DB row exists. Area 2 uses the QN
 * template; areas 1 and 3 use the HCM template.
 */
export function defaultValuesForArea(
  area?: string | null,
): EpdaParameterValues {
  const isQn = normalizeEpdaAreaKey(area) === '2';
  const base: EpdaParameterValues = {
    hours: {
      berthHours: 96,
      anchorageHours: 24,
      pilotageThirdMiles: 17,
      qnPilotageMiles: 5,
    },
    garbage: { atBerthUsd: 54, atBuoyUsd: 54, cbmAmount: 1 },
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
      { minLoa: 205, amount: 2800, label: '≥ 205m' },
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
      { minLoa: 0, amount: 1154, label: '0 - <90m' },
      { minLoa: 90, amount: 2308, label: '90 - <135m' },
      { minLoa: 135, amount: 3956, label: '135 - <175m' },
      { minLoa: 175, amount: 6792, label: '175 - <200m' },
      { minLoa: 200, amount: 9916, label: '≥ 200m' },
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
    if (layer.quarantine)
      out.quarantine = { ...out.quarantine, ...layer.quarantine };
    if (layer.coeff) out.coeff = { ...out.coeff, ...layer.coeff };
    if (Array.isArray(layer.agencyFeeTiers))
      out.agencyFeeTiers = layer.agencyFeeTiers.map((t) => ({ ...t }));
    if (Array.isArray(layer.moorUnmoorBerthTiers))
      out.moorUnmoorBerthTiers = layer.moorUnmoorBerthTiers.map((t) => ({
        ...t,
      }));
    if (Array.isArray(layer.moorUnmoorBuoyTiers))
      out.moorUnmoorBuoyTiers = layer.moorUnmoorBuoyTiers.map((t) => ({
        ...t,
      }));
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

  private async saveAudit(
    repository: Repository<EpdaParameterChangeLog>,
    entry: {
      scope: EpdaParameterScope;
      area: string | null;
      portId: number | null;
      action: EpdaParameterChangeAction;
      changedByUserId: number | null;
      beforeValues: PartialEpdaParameterValues | null;
      afterValues: PartialEpdaParameterValues | null;
    },
  ): Promise<void> {
    await repository.save(repository.create(entry));
  }

  listAll(): Promise<EpdaParameterSet[]> {
    return this.repo
      .find({ order: { scope: 'ASC', area: 'ASC', portId: 'ASC' } })
      .then((rows) =>
        rows.map((row) =>
          Object.assign(row, { area: normalizeEpdaAreaKey(row.area) }),
        ),
      );
  }

  async getAreaSet(
    area: string,
    repository: Repository<EpdaParameterSet> = this.repo,
  ): Promise<EpdaParameterSet | null> {
    const canonicalArea = normalizeEpdaAreaKey(area);
    if (!canonicalArea) {
      throw new BadRequestException(`Invalid EPDA area: ${area}`);
    }
    const rows = await repository
      .createQueryBuilder('epda')
      .where(`epda.scope = 'AREA'`)
      .andWhere('epda.area = :canonicalArea', { canonicalArea })
      .orderBy('epda.updatedAt', 'DESC')
      .getMany();
    const row = rows[0] ?? null;
    return row
      ? Object.assign(row, { area: normalizeEpdaAreaKey(row.area) })
      : null;
  }

  getPortOverride(
    portId: number,
    repository: Repository<EpdaParameterSet> = this.repo,
  ): Promise<EpdaParameterSet | null> {
    return repository.findOne({ where: { scope: 'PORT', portId } });
  }

  async upsertArea(
    area: string,
    values: PartialEpdaParameterValues,
    actorUserId?: number,
  ): Promise<EpdaParameterSet> {
    const normalizedArea = normalizeEpdaAreaKey(area);
    if (!normalizedArea) throw new NotFoundException('Invalid area');
    return this.repo.manager.transaction(async (manager) => {
      const repository = manager.getRepository(EpdaParameterSet);
      const auditRepository = manager.getRepository(EpdaParameterChangeLog);
      const existing = await this.getAreaSet(normalizedArea, repository);
      const before = existing ? existing.values : null;
      const saved = existing
        ? await repository.save(
            Object.assign(existing, {
              area: normalizedArea,
              values: mergeValues(normalizedArea, existing.values, values),
            }),
          )
        : await repository.save(
            repository.create({
              scope: 'AREA',
              area: normalizedArea,
              portId: null,
              values: mergeValues(normalizedArea, values),
            }),
          );
      await this.saveAudit(auditRepository, {
        scope: 'AREA',
        area: normalizedArea,
        portId: null,
        action: 'UPSERT_AREA',
        changedByUserId: actorUserId ?? null,
        beforeValues: before,
        afterValues: saved.values,
      });
      return saved;
    });
  }

  private async resolvePortArea(
    portId: number,
  ): Promise<'1' | '2' | '3' | null> {
    const port = await this.portRepo.findOne({
      where: { id: portId },
      relations: { province: true },
    });
    if (!port) throw new NotFoundException(`Port ${portId} not found`);
    const areaCode = normalizeProvinceAreaCode(port.province?.area ?? null);
    return areaCode ? (String(areaCode) as '1' | '2' | '3') : null;
  }

  async upsertPort(
    portId: number,
    values: PartialEpdaParameterValues,
    actorUserId?: number,
  ): Promise<EpdaParameterSet> {
    const area = await this.resolvePortArea(portId);
    return this.repo.manager.transaction(async (manager) => {
      const repository = manager.getRepository(EpdaParameterSet);
      const auditRepository = manager.getRepository(EpdaParameterChangeLog);
      const existing = await this.getPortOverride(portId, repository);
      const before = existing ? existing.values : null;
      const saved = existing
        ? await repository.save(
            Object.assign(existing, {
              area,
              // PUT semantics: the Parameter screen sends the complete partial
              // override document. Omitted nested fields are intentionally unset.
              values: this.replaceOverrideDocument(values),
            }),
          )
        : await repository.save(
            repository.create({
              scope: 'PORT',
              area,
              portId,
              values: this.replaceOverrideDocument(values),
            }),
          );
      await this.saveAudit(auditRepository, {
        scope: 'PORT',
        area,
        portId,
        action: 'UPSERT_PORT',
        changedByUserId: actorUserId ?? null,
        beforeValues: before,
        afterValues: saved.values,
      });
      return saved;
    });
  }

  async deletePort(portId: number, actorUserId?: number): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
      const repository = manager.getRepository(EpdaParameterSet);
      const auditRepository = manager.getRepository(EpdaParameterChangeLog);
      const existing = await this.getPortOverride(portId, repository);
      await repository.delete({ scope: 'PORT', portId });
      await this.saveAudit(auditRepository, {
        scope: 'PORT',
        area: existing?.area ?? null,
        portId,
        action: 'DELETE_PORT',
        changedByUserId: actorUserId ?? null,
        beforeValues: existing ? existing.values : null,
        afterValues: null,
      });
    });
  }

  // ---------- port groups (named set of ports inside an area) ----------

  async listGroups(area: string): Promise<EpdaParameterSet[]> {
    const canonicalArea = normalizeEpdaAreaKey(area);
    if (!canonicalArea) {
      throw new BadRequestException(`Invalid EPDA area: ${area}`);
    }
    const rows = await this.repo
      .createQueryBuilder('epda')
      .where(`epda.scope = 'GROUP'`)
      .andWhere('epda.area = :canonicalArea', { canonicalArea })
      .orderBy('epda.name', 'ASC')
      .getMany();
    return rows.map((row) =>
      Object.assign(row, { area: normalizeEpdaAreaKey(row.area) }),
    );
  }

  getGroup(id: number): Promise<EpdaParameterSet | null> {
    return this.repo.findOne({ where: { id, scope: 'GROUP' } });
  }

  /** The group (within `area`) that owns `portId`, if any. */
  async findGroupForPort(
    area: string,
    portId: number,
  ): Promise<EpdaParameterSet | null> {
    const groups = await this.listGroups(area);
    return groups.find((g) => (g.memberPortIds ?? []).includes(portId)) ?? null;
  }

  async createGroup(
    area: string,
    name: string,
    values: PartialEpdaParameterValues,
    actorUserId?: number,
  ): Promise<EpdaParameterSet> {
    const normalizedArea = normalizeEpdaAreaKey(area);
    if (!normalizedArea) throw new NotFoundException('Invalid area');
    return this.repo.manager.transaction(async (manager) => {
      await this.acquireGroupAreaLock(manager, normalizedArea);
      const repository = manager.getRepository(EpdaParameterSet);
      const saved = await repository.save(
        repository.create({
          scope: 'GROUP',
          area: normalizedArea,
          portId: null,
          name,
          memberPortIds: [],
          values: values ?? {},
        }),
      );
      await this.saveAudit(manager.getRepository(EpdaParameterChangeLog), {
        scope: 'GROUP',
        area: normalizedArea,
        portId: null,
        action: 'UPSERT_GROUP',
        changedByUserId: actorUserId ?? null,
        beforeValues: null,
        afterValues: saved.values,
      });
      return saved;
    });
  }

  async updateGroup(
    id: number,
    patch: { name?: string; values?: PartialEpdaParameterValues },
    actorUserId?: number,
  ): Promise<EpdaParameterSet> {
    return this.repo.manager.transaction(async (manager) => {
      const repository = manager.getRepository(EpdaParameterSet);
      const initial = await repository.findOne({
        where: { id, scope: 'GROUP' },
      });
      if (!initial) throw new NotFoundException(`Group ${id} not found`);
      const groupArea = normalizeEpdaAreaKey(initial.area);
      if (!groupArea) throw new BadRequestException('Group area is invalid');
      await this.acquireGroupAreaLock(manager, groupArea);

      const current = await repository.findOne({
        where: { id, scope: 'GROUP' },
      });
      if (!current) throw new NotFoundException(`Group ${id} not found`);
      const before = current.values;
      const metadataPatch: Partial<Pick<EpdaParameterSet, 'name' | 'values'>> =
        {};
      if (patch.name !== undefined) metadataPatch.name = patch.name;
      if (patch.values !== undefined) metadataPatch.values = patch.values;
      if (Object.keys(metadataPatch).length) {
        await repository.update({ id, scope: 'GROUP' }, metadataPatch);
        Object.assign(current, metadataPatch);
      }
      await this.saveAudit(manager.getRepository(EpdaParameterChangeLog), {
        scope: 'GROUP',
        area: groupArea,
        portId: null,
        action: 'UPSERT_GROUP',
        changedByUserId: actorUserId ?? null,
        beforeValues: before,
        afterValues: current.values,
      });
      return current;
    });
  }

  async deleteGroup(id: number, actorUserId?: number): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
      const repository = manager.getRepository(EpdaParameterSet);
      const initial = await repository.findOne({
        where: { id, scope: 'GROUP' },
      });
      if (!initial) return null;
      const groupArea = normalizeEpdaAreaKey(initial.area);
      if (!groupArea) throw new BadRequestException('Group area is invalid');
      await this.acquireGroupAreaLock(manager, groupArea);
      const current = await repository.findOne({
        where: { id, scope: 'GROUP' },
      });
      if (!current) return null;
      await repository.delete({ id, scope: 'GROUP' });
      await this.saveAudit(manager.getRepository(EpdaParameterChangeLog), {
        scope: 'GROUP',
        area: current.area,
        portId: null,
        action: 'DELETE_GROUP',
        changedByUserId: actorUserId ?? null,
        beforeValues: current.values,
        afterValues: null,
      });
      return current;
    });
  }

  /**
   * Replace a group's member ports. A port belongs to at most one group per area,
   * so any incoming port is first removed from sibling groups in the same area.
   */
  async setGroupMembers(
    id: number,
    portIds: number[],
    actorUserId?: number,
  ): Promise<EpdaParameterSet> {
    const unique = Array.from(new Set(portIds));
    if (unique.some((portId) => !Number.isInteger(portId) || portId <= 0)) {
      throw new BadRequestException(
        'Group member port ids must be positive integers',
      );
    }

    return this.repo.manager.transaction(async (manager) => {
      const parameterRepo = manager.getRepository(EpdaParameterSet);
      const transactionalPortRepo = manager.getRepository(Port);
      let group = await parameterRepo.findOne({
        where: { id, scope: 'GROUP' },
      });
      if (!group) throw new NotFoundException(`Group ${id} not found`);
      const groupArea = normalizeEpdaAreaKey(group.area);
      if (!groupArea) throw new BadRequestException('Group area is invalid');

      await this.acquireGroupAreaLock(manager, groupArea);
      const lockedGroup = await parameterRepo.findOne({
        where: { id, scope: 'GROUP' },
      });
      if (!lockedGroup) throw new NotFoundException(`Group ${id} not found`);
      group = lockedGroup;

      const ports = unique.length
        ? await transactionalPortRepo.find({
            where: { id: In(unique) },
            relations: { province: true },
          })
        : [];
      if (ports.length !== unique.length) {
        const found = new Set(ports.map((port) => port.id));
        const missing = unique.filter((portId) => !found.has(portId));
        throw new BadRequestException(`Ports not found: ${missing.join(', ')}`);
      }
      const wrongArea = ports.filter(
        (port) =>
          String(normalizeProvinceAreaCode(port.province?.area ?? null)) !==
          groupArea,
      );
      if (wrongArea.length) {
        throw new BadRequestException(
          `Ports outside group area ${groupArea}: ${wrongArea.map((port) => port.id).join(', ')}`,
        );
      }

      const siblings = await parameterRepo.find({
        where: { scope: 'GROUP', area: groupArea },
      });
      const changedSiblings = siblings
        .filter((sibling) => sibling.id !== id)
        .filter((sibling) =>
          (sibling.memberPortIds ?? []).some((portId) =>
            unique.includes(portId),
          ),
        );
      for (const sibling of changedSiblings) {
        sibling.memberPortIds = (sibling.memberPortIds ?? []).filter(
          (portId) => !unique.includes(portId),
        );
      }

      group.memberPortIds = unique;
      if (changedSiblings.length) await parameterRepo.save(changedSiblings);
      const saved = await parameterRepo.save(group);
      await this.saveAudit(manager.getRepository(EpdaParameterChangeLog), {
        scope: 'GROUP',
        area: groupArea,
        portId: null,
        action: 'SET_GROUP_MEMBERS',
        changedByUserId: actorUserId ?? null,
        beforeValues: null,
        afterValues: null,
      });
      return saved;
    });
  }

  private async acquireGroupAreaLock(
    manager: EntityManager,
    area: string,
  ): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `epda-group-area:${area}`,
    ]);
  }

  /** Recent Parameter-screen edits, filtered by port (preferred) or area. */
  async listChangeLogs(opts: {
    area?: string;
    portId?: number;
    limit?: number;
  }) {
    const qb = this.logRepo
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.changedBy', 'changedBy')
      .orderBy('log.createdAt', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .take(Math.min(100, Math.max(1, opts.limit ?? 50)));
    if (opts.portId != null)
      qb.where('log.portId = :portId', { portId: opts.portId });
    else if (opts.area) {
      const canonicalArea = normalizeEpdaAreaKey(opts.area);
      if (!canonicalArea) {
        throw new BadRequestException(`Invalid EPDA area: ${opts.area}`);
      }
      qb.where('log.area = :canonicalArea', { canonicalArea });
    }
    const rows = await qb.getMany();

    return rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      area: normalizeEpdaAreaKey(r.area),
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

  /**
   * Resolved values used by the EPDA form. Layers (later wins):
   * area set → group override (if the port belongs to a group) → port override.
   */
  async getEffective(
    area?: string,
    portId?: number,
  ): Promise<EpdaParameterValues> {
    const requestedArea = normalizeEpdaAreaKey(area);
    if (area?.trim() && !requestedArea) {
      throw new BadRequestException(`Invalid EPDA area: ${area}`);
    }
    if (portId != null && (!Number.isInteger(portId) || portId <= 0)) {
      throw new BadRequestException('portId must be a positive integer');
    }
    let normalizedArea = requestedArea;

    if (portId != null) {
      const derivedArea = await this.resolvePortArea(portId);
      if (!derivedArea) {
        throw new BadRequestException(
          `Port ${portId} is not assigned to an EPDA area`,
        );
      }
      if (requestedArea && requestedArea !== derivedArea) {
        throw new BadRequestException(
          `Port ${portId} belongs to area ${derivedArea}, not requested area ${requestedArea}`,
        );
      }
      normalizedArea = derivedArea;
    }

    if (!normalizedArea)
      throw new BadRequestException('A valid EPDA area or portId is required');
    const [areaSet, groupSet, portSet] = await Promise.all([
      this.getAreaSet(normalizedArea),
      portId
        ? this.findGroupForPort(normalizedArea, portId)
        : Promise.resolve(null),
      portId ? this.getPortOverride(portId) : Promise.resolve(null),
    ]);
    return mergeValues(
      normalizedArea,
      areaSet?.values,
      groupSet?.values,
      portSet?.values,
    );
  }

  private replaceOverrideDocument(
    values: PartialEpdaParameterValues,
  ): PartialEpdaParameterValues {
    return structuredClone(values);
  }
}

function normalizeEpdaAreaKey(value?: string | null): '1' | '2' | '3' | null {
  const normalized = value?.trim();
  return normalized === '1' || normalized === '2' || normalized === '3'
    ? normalized
    : null;
}
