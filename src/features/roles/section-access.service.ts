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
  id?: number | null;
  sessionVersion?: number | null;
  role?: {
    id?: number | null;
    name?: string | null;
    roleGroup?: RoleGroup | string | null;
  } | null;
};

type GrantsCacheEntry = {
  keys: string[];
  expiresAt: number;
};

function isExplicitlyNonInternalRole(user: UserLike): boolean {
  const roleGroup = user.role?.roleGroup;
  return roleGroup != null && roleGroup.trim().toUpperCase() !== 'INTERNAL';
}

@Injectable()
export class SectionAccessService {
  /** Short TTL so grant edits converge without Redis (P3). */
  private static readonly CACHE_TTL_MS = 30_000;

  /**
   * In-memory grants cache keyed by userId:roleId:sessionVersion.
   * sessionVersion bump → new key (natural invalidate); also cleared explicitly.
   */
  private readonly grantsCache = new Map<string, GrantsCacheEntry>();

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
    return this.getCachedSectionKeys(user);
  }

  /** Does the user's role grant access to `section`? Admins always pass. */
  async canAccessSection(user: UserLike, section: string): Promise<boolean> {
    // Fail closed for decorator typos or stale callers. Even administrators
    // should not make an unknown permission identifier appear valid.
    if (!isValidSectionKey(section)) return false;
    if (isExplicitlyNonInternalRole(user)) return false;
    if (isAdminRoleName(user?.role?.name)) return true;
    const keys = await this.getCachedSectionKeys(user);
    return keys.includes(section);
  }

  /** Drop cache entries for a user (call when sessionVersion bumps). */
  invalidateUser(userId: number): void {
    if (!Number.isInteger(userId) || userId <= 0) return;
    const prefix = `${userId}:`;
    for (const key of this.grantsCache.keys()) {
      if (key.startsWith(prefix)) {
        this.grantsCache.delete(key);
      }
    }
  }

  /** Drop cache entries for a role (call when section grants change). */
  invalidateRole(roleId: number): void {
    if (!Number.isInteger(roleId) || roleId <= 0) return;
    const needle = `:${roleId}:`;
    for (const key of this.grantsCache.keys()) {
      if (key.includes(needle)) {
        this.grantsCache.delete(key);
      }
    }
  }

  /** Test helper / emergency flush. */
  clearGrantsCache(): void {
    this.grantsCache.clear();
  }

  private cacheKey(user: UserLike): string | null {
    const userId = Number(user.id);
    const roleId = Number(user.role?.id);
    if (!Number.isInteger(userId) || userId <= 0) return null;
    if (!Number.isInteger(roleId) || roleId <= 0) return null;
    const sessionVersion =
      Number.isInteger(user.sessionVersion) && (user.sessionVersion as number) >= 1
        ? (user.sessionVersion as number)
        : 1;
    return `${userId}:${roleId}:${sessionVersion}`;
  }

  private async getCachedSectionKeys(user: UserLike): Promise<string[]> {
    const roleId = user?.role?.id ?? null;
    const key = this.cacheKey(user);
    if (key) {
      const hit = this.grantsCache.get(key);
      if (hit && hit.expiresAt > Date.now()) {
        return hit.keys;
      }
    }

    const keys = await this.getSectionKeysForRole(roleId);
    if (key) {
      this.grantsCache.set(key, {
        keys,
        expiresAt: Date.now() + SectionAccessService.CACHE_TTL_MS,
      });
    }
    return keys;
  }
}
