import {
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { Role } from './entities/role.entity';
import { User } from './entities/user.entity';
import { RoleGroup } from './enums/role-group.enum';

type RepositoryMock<T extends object> = {
  findOne: jest.Mock;
  createQueryBuilder: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  query: jest.Mock;
} & Partial<Repository<T>>;

const externalRole = {
  id: 2,
  name: 'ROLE_CUSTOMER',
  roleGroup: RoleGroup.EXTERNAL,
} as Role;

function queryBuilderReturning(user: User | null) {
  return {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(user),
  };
}

function createService(options?: {
  config?: Record<string, string>;
  existingUser?: User | null;
  role?: Role | null;
}) {
  const queryBuilder = queryBuilderReturning(options?.existingUser ?? null);
  const userRepository: RepositoryMock<User> = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    create: jest.fn((value: Partial<User>) => value as User),
    save: jest.fn((value: User) => Promise.resolve(value)),
    query: jest.fn(),
  };
  const configuredRole =
    options && Object.prototype.hasOwnProperty.call(options, 'role')
      ? options.role
      : externalRole;
  const roleRepository: RepositoryMock<Role> = {
    findOne: jest.fn().mockResolvedValue(configuredRole),
    createQueryBuilder: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    query: jest.fn(),
  };
  const config = options?.config ?? {};
  const configService = {
    get: jest.fn((key: string, fallback?: string) => config[key] ?? fallback),
  } as unknown as ConfigService;
  const jwtService = {
    sign: jest.fn().mockReturnValue('signed-jwt'),
  } as unknown as JwtService;
  const service = new AuthService(
    userRepository as Repository<User>,
    roleRepository as Repository<Role>,
    jwtService,
    configService,
    {
      invalidateUser: jest.fn(),
    } as never,
  );

  return {
    service,
    userRepository,
    roleRepository,
    queryBuilder,
  };
}

describe('AuthService security invariants', () => {
  const validRegistration = {
    email: '  Mixed.Case@Example.Test ',
    username: 'NewUser',
    password: 'Password1',
    fullName: 'Example User',
  };

  it('canonicalizes entity email and username before repository writes', () => {
    const user = Object.assign(new User(), {
      email: '  Mixed.Case@Example.Test ',
      username: '  NewUser ',
    });

    user.normalizeIdentityFields();

    expect(user.email).toBe('mixed.case@example.test');
    expect(user.username).toBe('newuser');
  });

  it('normalizes email before duplicate lookup and persistence', async () => {
    const { service, userRepository, roleRepository, queryBuilder } =
      createService();
    const loginSpy = jest.spyOn(service, 'login').mockResolvedValue({
      token: 'signed-jwt',
      user: {
        id: 1,
        email: 'mixed.case@example.test',
        username: 'newuser',
        fullName: 'Example User',
        phone: null,
        company: null,
        role: 'ROLE_CUSTOMER',
        roleGroup: RoleGroup.EXTERNAL,
        oauthProvider: null,
        emailVerified: false,
      },
      cookieMaxAgeMs: 3_600_000,
    });

    await service.register(validRegistration);

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'LOWER(user.email) = :email',
      {
        email: 'mixed.case@example.test',
      },
    );
    expect(roleRepository.findOne).toHaveBeenCalledWith({
      where: {
        name: 'ROLE_CUSTOMER',
        roleGroup: RoleGroup.EXTERNAL,
      },
    });
    expect(userRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'mixed.case@example.test',
        username: 'newuser',
        role: externalRole,
      }),
    );
    expect(loginSpy).toHaveBeenCalledWith({
      identifier: 'mixed.case@example.test',
      password: 'Password1',
    });
  });

  it('fails closed when the configured password-registration role is not external', async () => {
    const { service, roleRepository, userRepository } = createService({
      config: { DEFAULT_USER_ROLE: 'ROLE_ADMIN' },
      role: null,
    });

    await expect(service.register(validRegistration)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(roleRepository.findOne).toHaveBeenCalledWith({
      where: {
        name: 'ROLE_ADMIN',
        roleGroup: RoleGroup.EXTERNAL,
      },
    });
    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it('maps a concurrent normalized-email unique violation to Conflict', async () => {
    const { service, userRepository } = createService();
    userRepository.save.mockRejectedValue({
      code: '23505',
      constraint: 'UQ_users_email',
      detail: 'Key (email)=(mixed.case@example.test) already exists.',
    });

    await expect(service.register(validRegistration)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('maps a concurrent normalized-username unique violation to Conflict', async () => {
    const { service, userRepository } = createService();
    userRepository.save.mockRejectedValue({
      code: '23505',
      constraint: 'uq_users_username_normalized_nonblank',
      detail: 'Key (lower(btrim(username)))=(newuser) already exists.',
    });

    await expect(service.register(validRegistration)).rejects.toThrow(
      'Username already exists',
    );
  });

  it('rejects an OAuth profile whose provider did not verify the email', async () => {
    const { service, userRepository } = createService();

    await expect(
      service.findOrCreateOAuthUser({
        email: 'user@example.test',
        fullName: 'Example User',
        provider: 'google',
        providerId: 'google-id',
        emailVerified: false,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(userRepository.findOne).not.toHaveBeenCalled();
    expect(userRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('fails closed when the configured OAuth role is not external', async () => {
    const { service, roleRepository, userRepository } = createService({
      config: { DEFAULT_OAUTH_ROLE: 'ROLE_EMPLOYEE' },
      role: null,
    });

    await expect(
      service.findOrCreateOAuthUser({
        email: 'user@example.test',
        fullName: 'Example User',
        provider: 'google',
        providerId: 'google-id',
        emailVerified: true,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(roleRepository.findOne).toHaveBeenCalledWith({
      where: {
        name: 'ROLE_EMPLOYEE',
        roleGroup: RoleGroup.EXTERNAL,
      },
    });
    expect(userRepository.save).not.toHaveBeenCalled();
  });
});
