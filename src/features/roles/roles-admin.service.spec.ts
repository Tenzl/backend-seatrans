import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { Role } from '../auth/entities/role.entity';
import { User } from '../auth/entities/user.entity';
import { RoleGroup } from '../auth/enums/role-group.enum';
import { RoleSectionAccess } from './entities/role-section-access.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { RolesAdminService } from './roles-admin.service';
import { SectionAccessService } from './section-access.service';

type Harness = {
  service: RolesAdminService;
  dataSource: { transaction: jest.Mock };
  manager: {
    query: jest.Mock;
    getRepository: jest.Mock;
  };
  rootRoleRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  transactionRoleRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  transactionAccessRepository: {
    delete: jest.Mock;
    insert: jest.Mock;
  };
  transactionUserRepository: {
    count: jest.Mock;
  };
};

const roleResult = (overrides: Partial<Role> = {}): Role =>
  ({
    id: 7,
    name: 'ROLE_OPERATOR',
    description: null,
    roleGroup: RoleGroup.INTERNAL,
    ...overrides,
  }) as Role;

function queryBuilder(result: Role | null = null) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
  };
}

function setup(existingRole: Role | null = null): Harness {
  const rootRoleQuery = queryBuilder();
  const transactionRoleQuery = queryBuilder();
  const rootRoleRepository = {
    create: jest.fn((value: object) => value),
    save: jest.fn().mockImplementation((value: object) =>
      Promise.resolve({
        id: 7,
        ...value,
      }),
    ),
    findOne: jest.fn().mockResolvedValue(existingRole),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(() => rootRoleQuery),
  };
  const transactionRoleRepository = {
    create: jest.fn((value: object) => value),
    save: jest.fn().mockImplementation((value: object) =>
      Promise.resolve({
        id: 7,
        ...value,
      }),
    ),
    findOne: jest.fn().mockResolvedValue(existingRole),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(() => transactionRoleQuery),
  };
  const transactionAccessRepository = {
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    insert: jest.fn().mockResolvedValue({ identifiers: [] }),
  };
  const transactionUserRepository = {
    count: jest.fn().mockResolvedValue(0),
  };
  const manager = {
    query: jest.fn().mockResolvedValue([]),
    getRepository: jest.fn((entity: object) => {
      if (entity === Role) return transactionRoleRepository;
      if (entity === RoleSectionAccess) return transactionAccessRepository;
      if (entity === User) return transactionUserRepository;
      throw new Error('Unexpected entity');
    }),
    // Support the pre-hardening implementation so regression tests fail on
    // behavior rather than on an incomplete test double.
    delete: transactionAccessRepository.delete,
    insert: transactionAccessRepository.insert,
  };
  const dataSource = {
    transaction: jest
      .fn()
      .mockImplementation(
        (work: (entityManager: EntityManager) => Promise<unknown>) =>
          work(manager as unknown as EntityManager),
      ),
  };
  const rootUserRepository = {
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn(),
  };
  const rootAccessRepository = {
    find: jest.fn().mockResolvedValue([]),
  };
  const service = new RolesAdminService(
    rootRoleRepository as unknown as Repository<Role>,
    rootUserRepository as unknown as Repository<User>,
    rootAccessRepository as unknown as Repository<RoleSectionAccess>,
    dataSource as unknown as DataSource,
    {
      invalidateRole: jest.fn(),
      invalidateUser: jest.fn(),
      clearGrantsCache: jest.fn(),
    } as unknown as SectionAccessService,
  );
  jest.spyOn(service, 'listRoles').mockResolvedValue([
    {
      id: 7,
      name: 'ROLE_OPERATOR',
      description: null,
      roleGroup: RoleGroup.INTERNAL,
      isAdmin: false,
      userCount: 0,
      sections: ['data-ports'],
    },
  ]);

  return {
    service,
    dataSource,
    manager,
    rootRoleRepository,
    transactionRoleRepository,
    transactionAccessRepository,
    transactionUserRepository,
  };
}

describe('RolesAdminService write consistency', () => {
  it('creates the role and its sections in one advisory-locked transaction', async () => {
    const harness = setup();

    await harness.service.createRole({
      name: ' Role_Operator ',
      roleGroup: RoleGroup.INTERNAL,
      sections: ['data-ports'],
    });

    expect(harness.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(harness.manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['role-name:role_operator'],
    );
    expect(harness.transactionRoleRepository.save).toHaveBeenCalledTimes(1);
    expect(harness.transactionRoleRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ROLE_OPERATOR' }),
    );
    expect(harness.transactionAccessRepository.delete).toHaveBeenCalledWith({
      roleId: 7,
    });
    expect(harness.transactionAccessRepository.insert).toHaveBeenCalledWith([
      { roleId: 7, sectionKey: 'data-ports' },
    ]);
    expect(harness.rootRoleRepository.save).not.toHaveBeenCalled();
  });

  it('updates role fields and sections under the same row-locked transaction', async () => {
    const harness = setup(roleResult());

    await harness.service.updateRole(7, {
      name: 'ROLE_PORT_OPERATOR',
      description: 'Port operations',
      sections: ['data-ports'],
    });

    expect(harness.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(harness.transactionRoleRepository.findOne).toHaveBeenCalledWith({
      where: { id: 7 },
      lock: { mode: 'pessimistic_write' },
    });
    expect(harness.transactionRoleRepository.save).toHaveBeenCalledTimes(1);
    expect(harness.transactionAccessRepository.delete).toHaveBeenCalledWith({
      roleId: 7,
    });
    expect(harness.rootRoleRepository.save).not.toHaveBeenCalled();
  });

  it('maps a database unique violation to a stable role-name conflict', async () => {
    const harness = setup();
    harness.transactionRoleRepository.save.mockRejectedValueOnce({
      code: '23505',
    });

    await expect(
      harness.service.createRole({
        name: 'ROLE_OPERATOR',
        roleGroup: RoleGroup.INTERNAL,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('serializes deletion with role assignment and refuses an assigned role', async () => {
    const harness = setup(roleResult());
    harness.transactionUserRepository.count.mockResolvedValueOnce(1);

    await expect(harness.service.deleteRole(7)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(harness.transactionRoleRepository.findOne).toHaveBeenCalledWith({
      where: { id: 7 },
      lock: { mode: 'pessimistic_write' },
    });
    expect(harness.transactionRoleRepository.delete).not.toHaveBeenCalled();
  });

  it('does not change the security group of a role while users hold it', async () => {
    const harness = setup(roleResult());
    harness.transactionUserRepository.count.mockResolvedValueOnce(2);

    await expect(
      harness.service.updateRole(7, {
        roleGroup: RoleGroup.EXTERNAL,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(harness.transactionRoleRepository.save).not.toHaveBeenCalled();
  });
});

describe('RolesAdminService privilege boundaries', () => {
  it.each(['ADMIN', 'ROLE_ADMIN', ' role_admin '])(
    'does not allow creating reserved admin alias %p',
    async (name) => {
      const harness = setup();
      await expect(
        harness.service.createRole({
          name,
          roleGroup: RoleGroup.INTERNAL,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('does not allow mutating the reserved admin identity or group', async () => {
    const harness = setup(
      roleResult({ name: 'ROLE_ADMIN', roleGroup: RoleGroup.INTERNAL }),
    );

    await expect(
      harness.service.updateRole(7, {
        roleGroup: RoleGroup.EXTERNAL,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not assign dashboard sections to external roles', async () => {
    const harness = setup();

    await expect(
      harness.service.createRole({
        name: 'ROLE_CUSTOMER_PLUS',
        roleGroup: RoleGroup.EXTERNAL,
        sections: ['data-ports'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects ambiguous role identifiers instead of storing whitespace', async () => {
    const harness = setup();

    await expect(
      harness.service.createRole({
        name: 'ROLE PORT OPERATOR',
        roleGroup: RoleGroup.INTERNAL,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SectionAccessService fail-closed behavior', () => {
  it('rejects an unknown section even for an administrator', async () => {
    const service = new SectionAccessService({
      find: jest.fn(),
    } as unknown as Repository<RoleSectionAccess>);

    await expect(
      service.canAccessSection(
        { role: { id: 1, name: 'ROLE_ADMIN' } },
        'typo-nonexistent-section',
      ),
    ).resolves.toBe(false);
  });

  it('does not honor dashboard section rows for an external role', async () => {
    const service = new SectionAccessService({
      find: jest.fn().mockResolvedValue([{ sectionKey: 'data-ports' }]),
    } as unknown as Repository<RoleSectionAccess>);

    await expect(
      service.canAccessSection(
        {
          role: {
            id: 2,
            name: 'ROLE_CUSTOMER',
            roleGroup: RoleGroup.EXTERNAL,
          },
        },
        'data-ports',
      ),
    ).resolves.toBe(false);
  });

  it('caches grants by user+role+sessionVersion and invalidates on bump', async () => {
    const find = jest
      .fn()
      .mockResolvedValue([{ sectionKey: 'data-ports' }]);
    const service = new SectionAccessService({
      find,
    } as unknown as Repository<RoleSectionAccess>);

    const user = {
      id: 10,
      sessionVersion: 2,
      role: {
        id: 3,
        name: 'ROLE_OPERATOR',
        roleGroup: RoleGroup.INTERNAL,
      },
    };

    await expect(service.getSectionsForUser(user)).resolves.toEqual([
      'data-ports',
    ]);
    await expect(service.getSectionsForUser(user)).resolves.toEqual([
      'data-ports',
    ]);
    expect(find).toHaveBeenCalledTimes(1);

    service.invalidateUser(10);
    await expect(service.getSectionsForUser(user)).resolves.toEqual([
      'data-ports',
    ]);
    expect(find).toHaveBeenCalledTimes(2);

    await expect(
      service.getSectionsForUser({ ...user, sessionVersion: 3 }),
    ).resolves.toEqual(['data-ports']);
    expect(find).toHaveBeenCalledTimes(3);
  });
});

describe('role request validation', () => {
  it('canonicalizes role names and accepts only catalog section identifiers', async () => {
    const valid = plainToInstance(CreateRoleDto, {
      name: ' role_operator ',
      roleGroup: RoleGroup.INTERNAL,
      sections: ['data-ports'],
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(valid.name).toBe('ROLE_OPERATOR');

    const invalid = plainToInstance(CreateRoleDto, {
      name: 'ROLE_OPERATOR',
      roleGroup: RoleGroup.INTERNAL,
      sections: ['typo-section'],
    });
    await expect(validate(invalid)).resolves.not.toHaveLength(0);
  });
});
