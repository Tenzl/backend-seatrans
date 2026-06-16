import { applyDecorators, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../features/auth/guards/roles.guard';
import { Roles } from '../../features/auth/decorators/roles.decorator';
import { SectionAccessGuard } from '../../features/roles/guards/section-access.guard';
import { Section } from '../../features/roles/decorators/section.decorator';

/**
 * Admin API guard that also enforces dashboard section access:
 *   valid JWT + INTERNAL role + (role is admin OR role was granted `section`).
 *
 * Use on admin controllers that back a single dashboard page. The roles list
 * matches @ApiAdmin (internal staff); SectionAccessGuard then narrows it to the
 * roles that actually hold the section (admins always pass — anti-lockout).
 */
export function AdminSection(section: string) {
  return applyDecorators(
    UseGuards(AuthGuard('jwt'), RolesGuard, SectionAccessGuard),
    Roles('ROLE_ADMIN', 'ADMIN', 'ROLE_EMPLOYEE', 'EMPLOYEE', 'ROLE_INTERNAL', 'INTERNAL'),
    Section(section),
  );
}
