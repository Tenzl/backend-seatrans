import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Role } from '../auth/entities/role.entity';
import { User } from '../auth/entities/user.entity';
import { RoleGroup } from '../auth/enums/role-group.enum';
import { RoleSectionAccess } from './entities/role-section-access.entity';
import {
  GRANTABLE_SECTION_KEYS,
  SECTION_CATALOG,
  SECTION_KEYS,
} from './section-catalog';
import { isAdminRoleName, SectionAccessService } from './section-access.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

export interface RoleWithAccess {
  id: number;
  name: string;
  description: string | null;
  roleGroup: string;
  isAdmin: boolean;
  userCount: number;
  sections: string[];
}

@Injectable()
export class RolesAdminService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(RoleSectionAccess)
    private readonly accessRepo: Repository<RoleSectionAccess>,
    private readonly dataSource: DataSource,
    private readonly sectionAccess: SectionAccessService,
  ) {}

  getCatalog() {
    return SECTION_CATALOG;
  }

  /** Validate section keys against the catalog and de-dupe; reject admin-only keys. */
  private sanitizeSections(sections?: string[]): string[] {
    if (!sections?.length) return [];
    const invalid = sections.filter((k) => !SECTION_KEYS.includes(k));
    if (invalid.length) {
      throw new BadRequestException(
        `Unknown section(s): ${invalid.join(', ')}`,
      );
    }
    // Admin-only sections (users, roles) are privilege boundaries — they cannot
    // be granted to a role, even via a hand-crafted request.
    const forbidden = sections.filter(
      (k) => !GRANTABLE_SECTION_KEYS.includes(k),
    );
    if (forbidden.length) {
      throw new BadRequestException(
        `These sections can't be granted: ${forbidden.join(', ')}`,
      );
    }
    return Array.from(new Set(sections));
  }

  async listRoles(): Promise<RoleWithAccess[]> {
    const roles = await this.roleRepo.find({
      order: { roleGroup: 'ASC', name: 'ASC' },
    });

    // One grouped query for user counts, one fetch for section rows — no N+1.
    const countRows = await this.userRepo
      .createQueryBuilder('user')
      .select('user.role_id', 'roleId')
      .addSelect('COUNT(*)', 'count')
      .where('user.role_id IS NOT NULL')
      .groupBy('user.role_id')
      .getRawMany<{ roleId: number; count: string }>();
    const countByRole = new Map<number, number>(
      countRows.map((r) => [Number(r.roleId), Number(r.count)]),
    );

    const accessRows = await this.accessRepo.find();
    const sectionsByRole = new Map<number, string[]>();
    for (const row of accessRows) {
      if (!SECTION_KEYS.includes(row.sectionKey)) continue;
      const list = sectionsByRole.get(row.roleId) ?? [];
      list.push(row.sectionKey);
      sectionsByRole.set(row.roleId, list);
    }

    return roles.map((r) => {
      const isAdmin = isAdminRoleName(r.name);
      return {
        id: r.id,
        name: r.name,
        description: r.description ?? null,
        roleGroup: r.roleGroup,
        isAdmin,
        userCount: countByRole.get(r.id) ?? 0,
        // Admins implicitly hold every section (bypass) — reflect that to the UI.
        sections: isAdmin
          ? [...SECTION_KEYS]
          : (sectionsByRole.get(r.id) ?? []),
      };
    });
  }

  async createRole(dto: CreateRoleDto): Promise<RoleWithAccess> {
    const name = this.sanitizeRoleName(dto.name);
    const sections = this.sanitizeSections(dto.sections);
    this.assertRoleConfiguration(name, dto.roleGroup, sections, true);

    let roleId: number;
    try {
      roleId = await this.dataSource.transaction(async (manager) => {
        const roleRepo = manager.getRepository(Role);
        await this.lockRoleName(manager, name);
        if (await this.findRoleByName(roleRepo, name)) {
          throw new ConflictException('A role with this name already exists');
        }

        const role = await roleRepo.save(
          roleRepo.create({
            name,
            description: dto.description?.trim() || undefined,
            roleGroup: dto.roleGroup,
          }),
        );
        await this.replaceSections(manager, role.id, sections);
        return role.id;
      });
    } catch (error) {
      this.rethrowRoleNameConflict(error);
    }

    return this.getRole(roleId);
  }

  async updateRole(id: number, dto: UpdateRoleDto): Promise<RoleWithAccess> {
    const requestedSections =
      dto.sections === undefined
        ? undefined
        : this.sanitizeSections(dto.sections);

    try {
      await this.dataSource.transaction(async (manager) => {
        const roleRepo = manager.getRepository(Role);
        const role = await roleRepo.findOne({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!role) throw new NotFoundException('Role not found');

        const name =
          dto.name === undefined ? role.name : this.sanitizeRoleName(dto.name);
        const roleGroup = dto.roleGroup ?? role.roleGroup;
        this.assertAdminRoleUpdate(role, dto, name, roleGroup);
        if (!isAdminRoleName(role.name)) {
          this.assertRoleConfiguration(
            name,
            roleGroup,
            requestedSections ?? [],
            false,
          );
        }
        if (roleGroup !== role.roleGroup) {
          const assignedUsers = await manager
            .getRepository(User)
            .count({ where: { role: { id } } });
          if (assignedUsers > 0) {
            throw new BadRequestException(
              `This role is assigned to ${assignedUsers} user(s). Reassign them before changing its group.`,
            );
          }
        }

        if (dto.name !== undefined) {
          await this.lockRoleName(manager, name);
          const clash = await this.findRoleByName(roleRepo, name, id);
          if (clash) {
            throw new ConflictException('A role with this name already exists');
          }
          role.name = name;
        }
        if (dto.description !== undefined) {
          role.description = dto.description.trim();
        }
        role.roleGroup = roleGroup;
        await roleRepo.save(role);

        if (roleGroup === RoleGroup.EXTERNAL) {
          // External accounts never enter dashboard section guards. Clear stale
          // rows atomically when a role is moved out of the internal group.
          await this.replaceSections(manager, id, []);
        } else if (requestedSections !== undefined) {
          await this.replaceSections(manager, id, requestedSections);
        }
      });
    } catch (error) {
      this.rethrowRoleNameConflict(error);
    }

    return this.getRole(id);
  }

  async deleteRole(id: number): Promise<{ id: number }> {
    await this.dataSource.transaction(async (manager) => {
      const roleRepo = manager.getRepository(Role);
      const role = await roleRepo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!role) throw new NotFoundException('Role not found');

      // Anti-lockout: never delete an admin role.
      if (isAdminRoleName(role.name)) {
        throw new BadRequestException('Admin roles cannot be deleted');
      }

      // Block deletion while users still hold the role — they must be reassigned
      // first, otherwise they would silently lose all access.
      const userCount = await manager
        .getRepository(User)
        .count({ where: { role: { id } } });
      if (userCount > 0) {
        throw new BadRequestException(
          `This role is assigned to ${userCount} user(s). Reassign them before deleting.`,
        );
      }

      await roleRepo.delete(id);
    });
    return { id };
  }

  private async getRole(id: number): Promise<RoleWithAccess> {
    const all = await this.listRoles();
    const found = all.find((r) => r.id === id);
    if (!found) throw new NotFoundException('Role not found');
    return found;
  }

  private sanitizeRoleName(name: string): string {
    const normalized = name.trim().toUpperCase();
    if (normalized.length < 2 || normalized.length > 50) {
      throw new BadRequestException(
        'Role name must contain between 2 and 50 characters',
      );
    }
    if (!/^[A-Z][A-Z0-9_]*$/.test(normalized)) {
      throw new BadRequestException(
        'Role name must use letters, numbers and underscores only',
      );
    }
    return normalized;
  }

  private assertRoleConfiguration(
    name: string,
    roleGroup: RoleGroup,
    sections: string[],
    isCreate: boolean,
  ): void {
    if (isCreate && isAdminRoleName(name)) {
      throw new BadRequestException(
        'The administrator role is reserved and cannot be created',
      );
    }
    if (!isCreate && isAdminRoleName(name)) {
      throw new BadRequestException(
        'A role cannot be promoted to the reserved administrator identity',
      );
    }
    if (roleGroup === RoleGroup.EXTERNAL && sections.length > 0) {
      throw new BadRequestException(
        'Dashboard sections can only be assigned to INTERNAL roles',
      );
    }
  }

  private assertAdminRoleUpdate(
    role: Role,
    dto: UpdateRoleDto,
    requestedName: string,
    requestedGroup: RoleGroup,
  ): void {
    if (!isAdminRoleName(role.name)) return;

    if (
      requestedName !== role.name ||
      requestedGroup !== role.roleGroup ||
      dto.sections !== undefined
    ) {
      throw new BadRequestException(
        'The administrator role identity, group and access cannot be changed',
      );
    }
  }

  private async lockRoleName(
    manager: EntityManager,
    name: string,
  ): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `role-name:${name.toLowerCase()}`,
    ]);
  }

  private async findRoleByName(
    repository: Repository<Role>,
    name: string,
    excludeId?: number,
  ): Promise<Role | null> {
    const query = repository
      .createQueryBuilder('role')
      .where('LOWER(role.name) = :name', { name: name.toLowerCase() });
    if (excludeId !== undefined) {
      query.andWhere('role.id != :id', { id: excludeId });
    }
    return query.getOne();
  }

  private rethrowRoleNameConflict(error: unknown): never {
    if (error instanceof ConflictException) throw error;
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    ) {
      throw new ConflictException('A role with this name already exists');
    }
    throw error;
  }

  /** Replace a role's section set inside the caller-owned transaction. */
  private async replaceSections(
    manager: EntityManager,
    roleId: number,
    sections: string[],
  ): Promise<void> {
    const repository = manager.getRepository(RoleSectionAccess);
    await repository.delete({ roleId });
    if (sections.length) {
      await repository.insert(
        sections.map((sectionKey) => ({ roleId, sectionKey })),
      );
    }
    this.sectionAccess.invalidateRole(roleId);
  }
}
