import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RoleGroup } from '../enums/role-group.enum';

function normalizeRoleName(role: string): string {
  return role
    .trim()
    .toUpperCase()
    .replace(/^ROLE_/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseRoleGroup(value: unknown): RoleGroup | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'INTERNAL') return RoleGroup.INTERNAL;
  if (normalized === 'EXTERNAL') return RoleGroup.EXTERNAL;
  return null;
}

function roleContext(value: unknown): {
  roleNames: string[];
  roleGroup: RoleGroup | null;
} | null {
  if (!isRecord(value)) return null;
  const role = isRecord(value.role) ? value.role : null;
  const roleNames = Array.isArray(value.roles)
    ? value.roles.filter(
        (candidate): candidate is string =>
          typeof candidate === 'string' && candidate.trim().length > 0,
      )
    : typeof role?.name === 'string' && role.name.trim()
      ? [role.name]
      : [];
  return {
    roleNames,
    roleGroup: parseRoleGroup(role?.roleGroup),
  };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: unknown }>();
    const user = roleContext(request.user);
    if (!user) {
      return false;
    }

    if (user.roleNames.length === 0 && !user.roleGroup) {
      return false;
    }

    const normalizedUserRoles = user.roleNames.map(normalizeRoleName);
    const normalizedRequired = requiredRoles.map(normalizeRoleName);

    return normalizedRequired.some((required) => {
      const requiredGroup = parseRoleGroup(required);
      if (requiredGroup) return user.roleGroup === requiredGroup;
      return normalizedUserRoles.includes(required);
    });
  }
}
