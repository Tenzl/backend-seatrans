import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SECTION_KEY } from '../decorators/section.decorator';
import { SectionAccessService } from '../section-access.service';

/**
 * Enforces per-section access on top of the role guard. A handler/controller
 * tagged with @Section('key') is only reachable when the authenticated user's
 * role grants that section (admins always pass — see SectionAccessService).
 * Untagged handlers are unaffected.
 */
@Injectable()
export class SectionAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sectionAccess: SectionAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const section = this.reflector.getAllAndOverride<string>(SECTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No section tag → this guard imposes nothing (role guard still applies).
    if (!section) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    const allowed = await this.sectionAccess.canAccessSection(user, section);
    if (!allowed) {
      throw new ForbiddenException('You do not have access to this section');
    }
    return true;
  }
}
