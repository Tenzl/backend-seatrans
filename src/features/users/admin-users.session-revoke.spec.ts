import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AdminUsersService } from './admin-users.service';
import { User } from '../auth/entities/user.entity';
import { Role } from '../auth/entities/role.entity';
import { RoleGroup } from '../auth/enums/role-group.enum';

describe('AdminUsersService session revoke bumps', () => {
  function createService(user: User, role?: Role) {
    const userRepository = {
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn(async (value: User) => value),
      createQueryBuilder: jest.fn(),
      create: jest.fn(),
    };
    const roleRepository = {
      findOne: jest.fn().mockResolvedValue(role ?? null),
    };
    const configService = {
      get: jest.fn().mockReturnValue('12'),
    } as unknown as ConfigService;

    const service = new AdminUsersService(
      userRepository as unknown as Repository<User>,
      roleRepository as unknown as Repository<Role>,
      configService,
    );

    return { service, userRepository, roleRepository };
  }

  it('bumps sessionVersion on deactivate', async () => {
    const user = {
      id: 2,
      isActive: true,
      sessionVersion: 1,
    } as User;
    const { service, userRepository } = createService(user);

    await service.deleteUser(2, 1);

    expect(user.isActive).toBe(false);
    expect(user.sessionVersion).toBe(2);
    expect(userRepository.save).toHaveBeenCalledWith(user);
  });

  it('bumps sessionVersion on password reset', async () => {
    const user = {
      id: 2,
      isActive: true,
      sessionVersion: 3,
      password: 'old',
    } as User;
    const { service, userRepository } = createService(user);

    await service.resetPassword(2, 'NewPassword1');

    expect(user.sessionVersion).toBe(4);
    expect(user.password).not.toBe('old');
    expect(userRepository.save).toHaveBeenCalledWith(user);
  });

  it('bumps sessionVersion on role change', async () => {
    const currentRole = {
      id: 1,
      name: 'ROLE_EMPLOYEE',
      roleGroup: RoleGroup.INTERNAL,
    } as Role;
    const nextRole = {
      id: 2,
      name: 'ROLE_MANAGER',
      roleGroup: RoleGroup.INTERNAL,
    } as Role;
    const user = {
      id: 2,
      isActive: true,
      sessionVersion: 5,
      role: currentRole,
      email: 'u@example.test',
      username: null,
      fullName: null,
      phone: null,
      company: null,
      createdAt: new Date(),
    } as unknown as User;
    const { service, userRepository } = createService(user, nextRole);

    await service.updateUserRole(2, 2, 1);

    expect(user.sessionVersion).toBe(6);
    expect(user.role).toBe(nextRole);
    expect(userRepository.save).toHaveBeenCalledWith(user);
  });
});
