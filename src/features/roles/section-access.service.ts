import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoleSectionAccess } from './entities/role-section-access.entity';
import { SECTION_KEYS } from './section-catalog';

/** Normalize a backend role name ("ROLE_ADMIN", "Admin") → "ADMIN". */
function normalizeRoleName(role?: string | null): string {
  return (role ?? '').trim().toUpperCase().replace(/^ROLE_/, '');
}

/** Admin roles always have full access (anti-lockout); never gated by config. */
export function isAdminRoleName(role?: string | null): boolean {
  return normalizeRoleName(role).includes('ADMIN');
}

type UserLike = { role?: { id?: number | null; name?: string | null } | null };

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
    if (isAdminRoleName(user?.role?.name)) return [...SECTION_KEYS];
    return this.getSectionKeysForRole(user?.role?.id ?? null);
  }

  /** Does the user's role grant access to `section`? Admins always pass. */
  async canAccessSection(user: UserLike, section: string): Promise<boolean> {
    if (isAdminRoleName(user?.role?.name)) return true;
    const keys = await this.getSectionKeysForRole(user?.role?.id ?? null);
    return keys.includes(section);
  }
}
