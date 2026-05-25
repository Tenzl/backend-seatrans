import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

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
    // Assuming user.roles was populated correctly during authentication strategy step
    if (!user || (!user.roles && !user.role)) {
       return false;
    }

    const unrolledRoles = user.roles || [user.role?.name];

    return requiredRoles.some((role) => unrolledRoles?.includes(role));
  }
}
