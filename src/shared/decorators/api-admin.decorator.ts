import { applyDecorators, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../features/auth/guards/roles.guard';
import { Roles } from '../../features/auth/decorators/roles.decorator';
import { RoleGroup } from '../../features/auth/enums/role-group.enum';

/** JWT + role guard for admin/employee write APIs */
export function ApiAdmin() {
  return applyDecorators(
    UseGuards(AuthGuard('jwt'), RolesGuard),
    Roles(RoleGroup.INTERNAL),
  );
}
