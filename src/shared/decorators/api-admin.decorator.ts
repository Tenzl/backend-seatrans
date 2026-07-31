import { applyDecorators, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../features/auth/guards/roles.guard';
import { Roles } from '../../features/auth/decorators/roles.decorator';
import { RoleGroup } from '../../features/auth/enums/role-group.enum';

/**
 * Requires an authenticated internal staff account.
 *
 * The historical name is retained because it is already used by existing
 * controllers. Use ApiAdminOnly for operations reserved for ROLE_ADMIN.
 */
export function ApiAdmin() {
  return applyDecorators(
    UseGuards(AuthGuard('jwt'), RolesGuard),
    Roles(RoleGroup.INTERNAL),
  );
}

/** Requires the reserved ROLE_ADMIN role, not merely an internal account. */
export function ApiAdminOnly() {
  return applyDecorators(
    UseGuards(AuthGuard('jwt'), RolesGuard),
    Roles('ROLE_ADMIN'),
  );
}
