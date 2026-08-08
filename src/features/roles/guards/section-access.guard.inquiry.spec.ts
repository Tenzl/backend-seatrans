import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SectionAccessGuard } from './section-access.guard';
import { SectionAccessService } from '../section-access.service';
import { RoleGroup } from '../../auth/enums/role-group.enum';
import { SECTION_KEY } from '../decorators/section.decorator';

describe('SEC-02 inquiry AdminSection RBAC', () => {
  function createContext(user: unknown) {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as never;
  }

  it('returns 403 when INTERNAL staff lacks epda-inquiry', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['epda-inquiry']),
    } as unknown as Reflector;
    const sectionAccess = {
      canAccessSection: jest.fn().mockResolvedValue(false),
    } as unknown as SectionAccessService;
    const guard = new SectionAccessGuard(reflector, sectionAccess);

    await expect(
      guard.canActivate(
        createContext({
          role: {
            id: 9,
            name: 'ROLE_EMPLOYEE',
            roleGroup: RoleGroup.INTERNAL,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(sectionAccess.canAccessSection).toHaveBeenCalledWith(
      expect.objectContaining({
        role: expect.objectContaining({ name: 'ROLE_EMPLOYEE' }),
      }),
      'epda-inquiry',
    );
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(SECTION_KEY, [
      expect.anything(),
      expect.anything(),
    ]);
  });

  it('allows INTERNAL staff granted epda-inquiry', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['epda-inquiry']),
    } as unknown as Reflector;
    const sectionAccess = {
      canAccessSection: jest.fn().mockResolvedValue(true),
    } as unknown as SectionAccessService;
    const guard = new SectionAccessGuard(reflector, sectionAccess);

    await expect(
      guard.canActivate(
        createContext({
          role: {
            id: 9,
            name: 'ROLE_EMPLOYEE',
            roleGroup: RoleGroup.INTERNAL,
          },
        }),
      ),
    ).resolves.toBe(true);
  });
});
