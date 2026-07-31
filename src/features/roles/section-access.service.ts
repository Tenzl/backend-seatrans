import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoleSectionAccess } from './entities/role-section-access.entity';
import { isValidSectionKey, SECTION_KEYS } from './section-catalog';
import { RoleGroup } from '../auth/enums/role-group.enum';

/** Normalize a backend role name ("ROLE_ADMIN", "Admin") → "ADMIN". */
function normalizeRoleName(role?: string | null): string {
  return (role ?? '')
    .trim()
    .toUpperCase()
    .replace(/^ROLE_/, '');
}

/** Admin roles always have full access (anti-lockout); never gated by config. */
export function isAdminRoleName(role?: string | null): boolean {
  return normalizeRoleName(role) === 'ADMIN';
}

export type UserLike = {
  role?: {
    id?: number | null;
    name?: string | null;
    roleGroup?: RoleGroup | string | null;
  } | null;
};

function isExplicitlyNonInternalRole(user: UserLike): boolean {
  const roleGroup = user.role?.roleGroup;
  return roleGroup != null && roleGroup.trim().toUpperCase() !== 'INTERNAL';
}

@Injectable()
export class SectionAccessService {
  constructor(
    @InjectRepository(RoleSectionAccess)
    private readonly accessRepo: Repository<RoleSectionAccess>,
  ) {}

  /** Section keys explicitly granted to a role (empty if none / no role). */
  async getSectionKeysForRole(roleId?: number | null): Promise<string[]> {
    if (!roleId) return [];
    const rows = await this.accessRepo.find({
      where: { roleId },
      select: { sectionKey: true },
    });
    // Drop any keys no longer in the catalog (defensive against stale rows).
    return rows
      .map((r) => r.sectionKey)
      .filter((k) => SECTION_KEYS.includes(k));
  }

  /**
   * Effective sections for a user: admins get the whole catalog (bypass),
   * everyone else gets exactly what their role was granted.
   */
  async getSectionsForUser(user: UserLike): Promise<string[]> {
    if (isExplicitlyNonInternalRole(user)) return [];
    if (isAdminRoleName(user?.role?.name)) return [...SECTION_KEYS];
    return this.getSectionKeysForRole(user?.role?.id ?? null);
  }

  /** Does the user's role grant access to `section`? Admins always pass. */
  async canAccessSection(user: UserLike, section: string): Promise<boolean> {
    // Fail closed for decorator typos or stale callers. Even administrators
    // should not make an unknown permission identifier appear valid.
    if (!isValidSectionKey(section)) return false;
    if (isExplicitlyNonInternalRole(user)) return false;
    if (isAdminRoleName(user?.role?.name)) return true;
    const keys = await this.getSectionKeysForRole(user?.role?.id ?? null);
    return keys.includes(section);
  }
}
