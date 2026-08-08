import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  SECTION_KEY,
  SECTION_CHECK_SKIP,
} from '../decorators/section.decorator';
import { SectionAccessService, type UserLike } from '../section-access.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toUserLike(value: unknown): UserLike | null {
  if (!isRecord(value)) return null;
  if (value.role == null) {
    return {
      id: typeof value.id === 'number' ? value.id : null,
      sessionVersion:
        typeof value.sessionVersion === 'number' ? value.sessionVersion : null,
      role: null,
    };
  }
  if (!isRecord(value.role)) return null;

  const id = value.role.id;
  const name = value.role.name;
  const roleGroup = value.role.roleGroup;
  if (id != null && typeof id !== 'number') return null;
  if (name != null && typeof name !== 'string') return null;
  if (roleGroup != null && typeof roleGroup !== 'string') return null;
  return {
    id: typeof value.id === 'number' ? value.id : null,
    sessionVersion:
      typeof value.sessionVersion === 'number' ? value.sessionVersion : null,
    role: {
      id: id ?? null,
      name: name ?? null,
      roleGroup: roleGroup ?? null,
    },
  };
}

/**
 * Enforces per-section access on top of the role guard. A handler/controller
 * tagged with @Section('key') is only reachable when the authenticated user's
 * role grants that section (admins always pass — see SectionAccessService).
 * Untagged handlers / @SkipSectionCheck() are unaffected.
 */
@Injectable()
export class SectionAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sectionAccess: SectionAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const raw = this.reflector.getAllAndOverride<string | string[] | null>(
      SECTION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (raw == null || raw === SECTION_CHECK_SKIP) return true;

    const sections = Array.isArray(raw) ? raw : [raw];
    if (sections.length === 0 || sections.includes(SECTION_CHECK_SKIP))
      return true;

    const request = context.switchToHttp().getRequest<{ user?: unknown }>();
    const user = toUserLike(request.user);
    if (!user) return false;

    for (const section of sections) {
      if (await this.sectionAccess.canAccessSection(user, section)) {
        return true;
      }
    }

    throw new ForbiddenException('You do not have access to this section');
  }
}
