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
import { EpdaParameterGroupMember } from './entities/epda-parameter-group-member.entity';
import { User } from '../auth/entities/user.entity';
import {
  isEmptyEpdaOverride,
  validateEpdaParameterValues,
} from './epda-parameter-values.validation';
import {
  cloneEpdaOverrideDocument,
  hydrateEpdaParameterRows,
  normalizeEpdaAreaKey,
  resolveEpdaParameterValues,
  type EpdaAreaKey,
} from './epda-parameter-resolution';
import { EpdaParameterVersionControl } from './epda-parameter-version-control';

export { defaultValuesForArea } from './epda-parameter-resolution';

@Injectable()
export class EpdaParametersService {
  private readonly versionControl = new EpdaParameterVersionControl(
    EpdaParametersService.name,
  );

  constructor(
    @InjectRepository(EpdaParameterSet)
    private readonly repo: Repository<EpdaParameterSet>,
    @InjectRepository(EpdaParameterChangeLog)
    private readonly logRepo: Repository<EpdaParameterChangeLog>,
    @InjectRepository(Port)
    private readonly portRepo: Repository<Port>,
  ) {}

  private async saveAudit(
    manager: EntityManager,
    entry: {
      scope: EpdaParameterScope;
      area: string | null;
      portId: number | null;
      action: EpdaParameterChangeAction;
      changedByUserId: number | null;
      beforeValues: PartialEpdaParameterValues | null;
      afterValues: PartialEpdaParameterValues | null;
      details?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    const repository = manager.getRepository(EpdaParameterChangeLog);
    const [actor, port] = await Promise.all([
      entry.changedByUserId
        ? manager
            .getRepository(User)
            .findOne({ where: { id: entry.changedByUserId } })
        : Promise.resolve(null),
      entry.portId
        ? manager.getRepository(Port).findOne({ where: { id: entry.portId } })
        : Promise.resolve(null),
    ]);
    await repository.save(
      repository.create({
        ...entry,
        portName: port?.name ?? null,
        changedByName: actor?.fullName ?? null,
        changedByEmail: actor?.email ?? null,
        details: entry.details ?? null,
      }),
    );
  }

  async listAll(): Promise<EpdaParameterSet[]> {
    const rows = await this.repo.find({
      order: { scope: 'ASC', area: 'ASC', portId: 'ASC' },
    });
    return this.hydrateRows(rows);
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

  private findPortOverride(
    portId: number,
    repository: Repository<EpdaParameterSet> = this.repo,
  ): Promise<EpdaParameterSet | null> {
    return repository.findOne({ where: { scope: 'PORT', portId } });
  }

  async getPortOverride(
    portId: number,
    manager?: EntityManager,
  ): Promise<EpdaParameterSet | null> {
    const repository = manager
      ? manager.getRepository(EpdaParameterSet)
      : this.repo;
    const row = await this.findPortOverride(portId, repository);
    if (!row) return null;
    const area = await this.resolvePortArea(portId, manager);
    return Object.assign(row, { area });
  }

  async upsertArea(
    area: string,
    values: PartialEpdaParameterValues,
    actorUserId?: number,
    expectedVersion?: number | null,
  ): Promise<EpdaParameterSet> {
    const normalizedArea = normalizeEpdaAreaKey(area);
    if (!normalizedArea) throw new NotFoundException('Invalid area');
    validateEpdaParameterValues(values);
    return this.repo.manager.transaction(async (manager) => {
      const repository = manager.getRepository(EpdaParameterSet);
      const existing = await this.getAreaSet(normalizedArea, repository);
      const before = existing ? existing.values : null;
      const saved = existing
        ? await this.versionControl.updateWithVersion(
            repository,
            existing,
            {
              area: normalizedArea,
              values: resolveEpdaParameterValues(
                normalizedArea,
                existing.values,
                values,
              ),
            },
            expectedVersion,
            `Area ${normalizedArea}`,
          )
        : await repository.save(
            this.versionControl.createAfterVersionCheck(
              repository,
              {
                scope: 'AREA',
                area: normalizedArea,
                portId: null,
                name: null,
                memberPortIds: null,
                values: resolveEpdaParameterValues(normalizedArea, values),
              },
              expectedVersion,
              `Area ${normalizedArea}`,
            ),
          );
      await this.saveAudit(manager, {
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
    manager?: EntityManager,
  ): Promise<EpdaAreaKey | null> {
    const portRepository = manager
      ? manager.getRepository(Port)
      : this.portRepo;
    const port = await portRepository.findOne({
      where: { id: portId },
      relations: { province: true },
    });
    if (!port) throw new NotFoundException(`Port ${portId} not found`);
    const areaCode = normalizeProvinceAreaCode(port.province?.area ?? null);
    return areaCode ? normalizeEpdaAreaKey(String(areaCode)) : null;
  }

  async upsertPort(
    portId: number,
    values: PartialEpdaParameterValues,
    actorUserId?: number,
    expectedVersion?: number | null,
  ): Promise<EpdaParameterSet> {
    const area = await this.resolvePortArea(portId);
    if (!area) {
      throw new BadRequestException(
        `Port ${portId} is not assigned to an EPDA area`,
      );
    }
    validateEpdaParameterValues(values);
    if (isEmptyEpdaOverride(values)) {
      throw new BadRequestException(
        'Port override cannot be empty; delete it to inherit its baseline',
      );
    }
    return this.repo.manager.transaction(async (manager) => {
      const repository = manager.getRepository(EpdaParameterSet);
      const existing = await this.findPortOverride(portId, repository);
      const before = existing ? existing.values : null;
      const saved = existing
        ? await this.versionControl.updateWithVersion(
            repository,
            existing,
            {
              area: null,
              // PUT semantics: the Parameter screen sends the complete partial
              // override document. Omitted nested fields are intentionally unset.
              values: cloneEpdaOverrideDocument(values),
            },
            expectedVersion,
            `Port override ${portId}`,
          )
        : await repository.save(
            this.versionControl.createAfterVersionCheck(
              repository,
              {
                scope: 'PORT',
                area: null,
                portId,
                name: null,
                memberPortIds: null,
                values: cloneEpdaOverrideDocument(values),
              },
              expectedVersion,
              `Port override ${portId}`,
            ),
          );
      await this.saveAudit(manager, {
        scope: 'PORT',
        area,
        portId,
        action: 'UPSERT_PORT',
        changedByUserId: actorUserId ?? null,
        beforeValues: before,
        afterValues: saved.values,
      });
      return Object.assign(saved, { area });
    });
  }

  async deletePort(
    portId: number,
    actorUserId?: number,
    expectedVersion?: number | null,
  ): Promise<void> {
    const area = await this.resolvePortArea(portId);
    await this.repo.manager.transaction(async (manager) => {
      const repository = manager.getRepository(EpdaParameterSet);
      const existing = await this.findPortOverride(portId, repository);
      if (!existing) return;
      this.versionControl.assertExpectedVersion(
        existing,
        expectedVersion,
        `Port override ${portId}`,
      );
      const result = await repository.delete({
        scope: 'PORT',
        portId,
        version: existing.version ?? 1,
      });
      if (result.affected !== 1) {
        await this.versionControl.throwVersionConflict(
          repository,
          existing.id,
          portId,
        );
      }
      await this.saveAudit(manager, {
        scope: 'PORT',
        area,
        portId,
        action: 'DELETE_PORT',
        changedByUserId: actorUserId ?? null,
        beforeValues: existing.values,
        afterValues: null,
      });
    });
  }

  // ---------- port groups (named set of ports inside an area) ----------

  async listGroups(
    area: string,
    manager?: EntityManager,
  ): Promise<EpdaParameterSet[]> {
    const canonicalArea = normalizeEpdaAreaKey(area);
    if (!canonicalArea) {
      throw new BadRequestException(`Invalid EPDA area: ${area}`);
    }
    const repository = manager
      ? manager.getRepository(EpdaParameterSet)
      : this.repo;
    const rows = await repository
      .createQueryBuilder('epda')
      .where(`epda.scope = 'GROUP'`)
      .andWhere('epda.area = :canonicalArea', { canonicalArea })
      .orderBy('epda.name', 'ASC')
      .getMany();
    return this.hydrateRows(rows, manager ?? this.repo.manager);
  }

  getGroup(id: number): Promise<EpdaParameterSet | null> {
    return this.repo.findOne({ where: { id, scope: 'GROUP' } });
  }

  /** The group (within `area`) that owns `portId`, if any. */
  async findGroupForPort(
    area: string,
    portId: number,
    manager?: EntityManager,
  ): Promise<EpdaParameterSet | null> {
    const membershipRepository = manager
      ? manager.getRepository(EpdaParameterGroupMember)
      : this.repo.manager.getRepository(EpdaParameterGroupMember);
    const membership = await membershipRepository.findOne({
      where: { portId },
      relations: { group: true },
    });
    if (
      membership?.group &&
      normalizeEpdaAreaKey(membership.group.area) === normalizeEpdaAreaKey(area)
    ) {
      return Object.assign(membership.group, {
        memberPortIds: [portId],
      });
    }
    const groups = await this.listGroups(area, manager);
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
    validateEpdaParameterValues(values);
    const normalizedName = name.trim();
    if (!normalizedName)
      throw new BadRequestException('Group name is required');
    return this.repo.manager.transaction(async (manager) => {
      await this.acquireGroupAreaLock(manager, normalizedArea);
      const repository = manager.getRepository(EpdaParameterSet);
      const saved = await repository.save(
        repository.create({
          scope: 'GROUP',
          area: normalizedArea,
          portId: null,
          name: normalizedName,
          memberPortIds: null,
          values: values ?? {},
        }),
      );
      await this.saveAudit(manager, {
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
    expectedVersion?: number | null,
  ): Promise<EpdaParameterSet> {
    if (patch.values !== undefined) validateEpdaParameterValues(patch.values);
    const normalizedName = patch.name?.trim();
    if (patch.name !== undefined && !normalizedName) {
      throw new BadRequestException('Group name is required');
    }
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
      const beforeName = current.name;
      const metadataPatch: Partial<Pick<EpdaParameterSet, 'name' | 'values'>> =
        {};
      if (normalizedName !== undefined) metadataPatch.name = normalizedName;
      if (patch.values !== undefined) metadataPatch.values = patch.values;
      const saved = Object.keys(metadataPatch).length
        ? await this.versionControl.updateWithVersion(
            repository,
            current,
            metadataPatch,
            expectedVersion,
            `Group ${id}`,
          )
        : current;
      await this.saveAudit(manager, {
        scope: 'GROUP',
        area: groupArea,
        portId: null,
        action: 'UPSERT_GROUP',
        changedByUserId: actorUserId ?? null,
        beforeValues: before,
        afterValues: saved.values,
        details: {
          before: { name: beforeName },
          after: { name: saved.name },
        },
      });
      const [hydrated] = await this.hydrateRows([saved], manager);
      return hydrated;
    });
  }

  async deleteGroup(
    id: number,
    actorUserId?: number,
    expectedVersion?: number | null,
  ): Promise<void> {
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
      this.versionControl.assertExpectedVersion(
        current,
        expectedVersion,
        `Group ${id}`,
      );
      const result = await repository.delete({
        id,
        scope: 'GROUP',
        version: current.version ?? 1,
      });
      if (result.affected !== 1) {
        await this.versionControl.throwVersionConflict(repository, id);
      }
      await this.saveAudit(manager, {
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
   * Replace a group's member ports. A port belongs to at most one group
   * (enforced by rewriting epda_parameter_group_members). JSONB member_port_ids
   * is no longer written.
   */
  async setGroupMembers(
    id: number,
    portIds: number[],
    actorUserId?: number,
    expectedVersion?: number | null,
  ): Promise<EpdaParameterSet> {
    const unique = Array.from(new Set(portIds));
    if (unique.some((portId) => !Number.isInteger(portId) || portId <= 0)) {
      throw new BadRequestException(
        'Group member port ids must be positive integers',
      );
    }

    return this.repo.manager.transaction(async (manager) => {
      const parameterRepo = manager.getRepository(EpdaParameterSet);
      const membershipRepo = manager.getRepository(EpdaParameterGroupMember);
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
      this.versionControl.assertExpectedVersion(
        group,
        expectedVersion,
        `Group ${id}`,
      );

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

      const existingMemberships = await membershipRepo.find({
        where: { groupId: id },
      });
      const beforeMembers = existingMemberships
        .map((member) => member.portId)
        .sort((left, right) => left - right);

      await membershipRepo.delete({ groupId: id });
      if (unique.length > 0) {
        // One port → one group globally (unique on port_id if present, else rewrite).
        await membershipRepo.delete({ portId: In(unique) });
        await membershipRepo.save(
          unique.map((portId) =>
            membershipRepo.create({ groupId: id, portId }),
          ),
        );
      }

      // Bump optimistic version without dual-writing JSONB membership.
      const saved = await this.versionControl.updateWithVersion(
        parameterRepo,
        group,
        { name: group.name },
        expectedVersion,
        `Group ${id}`,
      );
      await this.saveAudit(manager, {
        scope: 'GROUP',
        area: groupArea,
        portId: null,
        action: 'SET_GROUP_MEMBERS',
        changedByUserId: actorUserId ?? null,
        beforeValues: null,
        afterValues: null,
        details: {
          before: { memberPortIds: beforeMembers },
          after: { memberPortIds: unique },
        },
      });
      return Object.assign(saved, { memberPortIds: unique });
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
        fullName: r.changedBy?.fullName ?? r.changedByName ?? null,
        email: r.changedBy?.email ?? r.changedByEmail ?? null,
      },
      portName: r.portName,
      beforeValues: r.beforeValues,
      afterValues: r.afterValues,
      details: r.details,
    }));
  }

  /**
   * Resolved values used by the EPDA form. Layers (later wins):
   * area set → group override (if the port belongs to a group) → port override.
   *
   * Pass `manager` when calling from an open transaction so reads stay on the
   * same connection (avoids pool dual-checkout while a row lock is held).
   */
  async getEffective(
    area?: string,
    portId?: number,
    manager?: EntityManager,
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
      const derivedArea = await this.resolvePortArea(portId, manager);
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
      manager
        ? this.getAreaSet(
            normalizedArea,
            manager.getRepository(EpdaParameterSet),
          )
        : this.getAreaSet(normalizedArea),
      portId
        ? manager
          ? this.findGroupForPort(normalizedArea, portId, manager)
          : this.findGroupForPort(normalizedArea, portId)
        : Promise.resolve(null),
      portId
        ? manager
          ? this.getPortOverride(portId, manager)
          : this.getPortOverride(portId)
        : Promise.resolve(null),
    ]);
    return resolveEpdaParameterValues(
      normalizedArea,
      areaSet?.values,
      groupSet?.values,
      portSet?.values,
    );
  }

  private async hydrateRows(
    rows: EpdaParameterSet[],
    manager: EntityManager = this.repo.manager,
  ): Promise<EpdaParameterSet[]> {
    if (rows.length === 0) return [];
    const groupIds = rows
      .filter((row) => row.scope === 'GROUP')
      .map((row) => row.id);
    const portIds = rows
      .filter(
        (row): row is EpdaParameterSet & { portId: number } =>
          row.scope === 'PORT' && row.portId != null,
      )
      .map((row) => row.portId);
    const [memberships, ports] = await Promise.all([
      groupIds.length
        ? manager.getRepository(EpdaParameterGroupMember).find({
            where: { groupId: In(groupIds) },
          })
        : Promise.resolve([]),
      portIds.length
        ? manager.getRepository(Port).find({
            where: { id: In(portIds) },
            relations: { province: true },
          })
        : Promise.resolve([]),
    ]);
    return hydrateEpdaParameterRows(rows, memberships, ports);
  }
}
