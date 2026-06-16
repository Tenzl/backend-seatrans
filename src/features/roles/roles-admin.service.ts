import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Role } from '../auth/entities/role.entity';
import { User } from '../auth/entities/user.entity';
import { RoleSectionAccess } from './entities/role-section-access.entity';
import { GRANTABLE_SECTION_KEYS, SECTION_CATALOG, SECTION_KEYS } from './section-catalog';
import { isAdminRoleName } from './section-access.service';
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
  ) {}

  getCatalog() {
    return SECTION_CATALOG;
  }

  /** Validate section keys against the catalog and de-dupe; reject admin-only keys. */
  private sanitizeSections(sections?: string[]): string[] {
    if (!sections?.length) return [];
    const invalid = sections.filter((k) => !SECTION_KEYS.includes(k));
    if (invalid.length) {
      throw new BadRequestException(`Unknown section(s): ${invalid.join(', ')}`);
    }
    // Admin-only sections (users, roles) are privilege boundaries — they cannot
    // be granted to a role, even via a hand-crafted request.
    const forbidden = sections.filter((k) => !GRANTABLE_SECTION_KEYS.includes(k));
    if (forbidden.length) {
      throw new BadRequestException(
        `These sections can't be granted: ${forbidden.join(', ')}`,
      );
    }
    return Array.from(new Set(sections));
  }

  async listRoles(): Promise<RoleWithAccess[]> {
    const roles = await this.roleRepo.find({
      order: { roleGroup: 'ASC' as any, name: 'ASC' as any },
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
        sections: isAdmin ? [...SECTION_KEYS] : sectionsByRole.get(r.id) ?? [],
      };
    });
  }

  async createRole(dto: CreateRoleDto): Promise<RoleWithAccess> {
    const name = dto.name.trim();
    const existing = await this.roleRepo
      .createQueryBuilder('role')
      .where('LOWER(role.name) = :name', { name: name.toLowerCase() })
      .getOne();
    if (existing) {
      throw new ConflictException('A role with this name already exists');
    }

    const sections = this.sanitizeSections(dto.sections);
    const role = await this.roleRepo.save(
      this.roleRepo.create({
        name,
        description: dto.description?.trim() || undefined,
        roleGroup: dto.roleGroup,
      }),
    );
    if (sections.length) await this.replaceSections(role.id, sections);

    return this.getRole(role.id);
  }

  async updateRole(id: number, dto: UpdateRoleDto): Promise<RoleWithAccess> {
    const role = await this.roleRepo.findOne({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const clash = await this.roleRepo
        .createQueryBuilder('role')
        .where('LOWER(role.name) = :name AND role.id != :id', {
          name: name.toLowerCase(),
          id,
        })
        .getOne();
      if (clash) throw new ConflictException('A role with this name already exists');
      role.name = name;
    }
    if (dto.description !== undefined) role.description = dto.description.trim();
    if (dto.roleGroup !== undefined) role.roleGroup = dto.roleGroup;
    await this.roleRepo.save(role);

    if (dto.sections !== undefined) {
      await this.replaceSections(id, this.sanitizeSections(dto.sections));
    }
    return this.getRole(id);
  }

  async deleteRole(id: number): Promise<{ id: number }> {
    const role = await this.roleRepo.findOne({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');

    // Anti-lockout: never delete an admin role.
    if (isAdminRoleName(role.name)) {
      throw new BadRequestException('Admin roles cannot be deleted');
    }

    // Block deletion while users still hold the role — they must be reassigned
    // first, otherwise they would silently lose all access.
    const userCount = await this.userRepo.count({ where: { role: { id } } });
    if (userCount > 0) {
      throw new BadRequestException(
        `This role is assigned to ${userCount} user(s). Reassign them before deleting.`,
      );
    }

    await this.roleRepo.delete(id); // section rows cascade via FK
    return { id };
  }

  private async getRole(id: number): Promise<RoleWithAccess> {
    const all = await this.listRoles();
    const found = all.find((r) => r.id === id);
    if (!found) throw new NotFoundException('Role not found');
    return found;
  }

  /** Replace a role's section set atomically (delete-all then insert). */
  private async replaceSections(roleId: number, sections: string[]): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(RoleSectionAccess, { roleId });
      if (sections.length) {
        await manager.insert(
          RoleSectionAccess,
          sections.map((sectionKey) => ({ roleId, sectionKey })),
        );
      }
    });
  }
}
