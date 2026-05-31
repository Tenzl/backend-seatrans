import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

function normalizeRoleName(role: string): string {
  return role.trim().toUpperCase().replace(/^ROLE_/, '');
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      return false;
    }

    const userRoleNames: string[] = Array.isArray(user.roles)
      ? user.roles.filter(Boolean)
      : user.role?.name
        ? [user.role.name]
        : [];

    if (userRoleNames.length === 0) {
      return false;
    }

    const normalizedUserRoles = userRoleNames.map(normalizeRoleName);
    const normalizedRequired = requiredRoles.map(normalizeRoleName);

    return normalizedRequired.some((required) => normalizedUserRoles.includes(required));
  }
}
