import { applyDecorators, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../features/auth/guards/roles.guard';
import { Roles } from '../../features/auth/decorators/roles.decorator';

/** JWT + role guard for admin/employee write APIs */
export function ApiAdmin() {
  return applyDecorators(
    UseGuards(AuthGuard('jwt'), RolesGuard),
    Roles('ROLE_ADMIN', 'ADMIN', 'ROLE_EMPLOYEE', 'EMPLOYEE', 'ROLE_INTERNAL', 'INTERNAL'),
  );
}
