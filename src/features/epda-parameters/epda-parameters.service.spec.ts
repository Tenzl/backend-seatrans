import {
  BadRequestException,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { EpdaParametersService } from './epda-parameters.service';
import { EpdaParameterSet } from './entities/epda-parameter-set.entity';
import { EpdaParameterChangeLog } from './entities/epda-parameter-change-log.entity';
import { Port } from '../ports/entities/port.entity';
import { User } from '../auth/entities/user.entity';
import { EpdaParameterGroupMember } from './entities/epda-parameter-group-member.entity';

describe('EpdaParametersService increment 1', () => {
  function setup() {
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    };
    const transactionManager = {
      getRepository: jest.fn(),
      query: jest.fn(),
    };
    const repo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
      create: jest.fn((value: unknown) => value),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      manager: {
        transaction: jest.fn(
          (work: (manager: typeof transactionManager) => Promise<unknown>) =>
            work(transactionManager),
        ),
      },
    };
    const logRepo = {
      save: jest.fn(),
      create: jest.fn((value: unknown) => value),
    };
    const portRepo = { findOne: jest.fn(), find: jest.fn() };
    const userRepo = { findOne: jest.fn().mockResolvedValue(null) };
    const membershipRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
      create: jest.fn((value: unknown) => value),
    };
    transactionManager.getRepository.mockImplementation((entity: unknown) => {
      if (entity === EpdaParameterSet) return repo;
      if (entity === EpdaParameterChangeLog) return logRepo;
      if (entity === EpdaParameterGroupMember) return membershipRepo;
      if (entity === Port) return portRepo;
      if (entity === User) return userRepo;
      throw new Error('Unexpected transaction repository');
    });
    const service = new EpdaParametersService(
      repo as never,
      logRepo as never,
      portRepo as never,
    );
    return {
      service,
      repo,
      logRepo,
      portRepo,
      userRepo,
      membershipRepo,
      transactionManager,
      queryBuilder,
    };
  }

  it('queries only the canonical area row and never falls back to aliases', async () => {
    const { service, queryBuilder } = setup();
    queryBuilder.getMany.mockResolvedValue([
      {
        id: 1,
        scope: 'AREA',
        area: '2',
        values: { hours: { berthHours: 64 } },
      },
    ]);

    const result = await service.getAreaSet('2');

    expect(result?.id).toBe(1);
    expect(result?.values.hours?.berthHours).toBe(64);
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'epda.area = :canonicalArea',
      { canonicalArea: '2' },
    );
  });

  it('replaces the complete PORT override document instead of shallow-merging nested state', async () => {
    const { service, repo, portRepo } = setup();
    portRepo.findOne.mockResolvedValue({ id: 21, province: { area: 1 } });
    const existing = {
      id: 5,
      scope: 'PORT',
      portId: 21,
      area: '1',
      version: 1,
      values: { coeff: { clearanceFee: 50, navigationPerGrt: 0.1 } },
    };
    repo.findOne.mockResolvedValue(existing);
    repo.update.mockImplementation(
      (_criteria: unknown, patch: Record<string, unknown>) => {
        Object.assign(existing, patch, { version: 2 });
        return Promise.resolve({ affected: 1 });
      },
    );

    const saved = await service.upsertPort(21, {
      coeff: { clearanceFee: 75 },
    });

    expect(saved.values).toEqual({ coeff: { clearanceFee: 75 } });
    expect(saved.values.coeff).not.toHaveProperty('navigationPerGrt');
    expect(saved.area).toBe('1');
    expect(repo.update).toHaveBeenCalledWith(
      { id: 5, scope: 'PORT', version: 1 },
      {
        area: null,
        values: { coeff: { clearanceFee: 75 } },
      },
    );
  });

  it('rejects an empty PORT override instead of persisting it', async () => {
    const { service, repo, portRepo } = setup();
    portRepo.findOne.mockResolvedValue({ id: 21, province: { area: 1 } });

    await expect(service.upsertPort(21, {}, 99, null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.manager.transaction).not.toHaveBeenCalled();
  });

  it('returns 409 before updating when expectedVersion is stale', async () => {
    const { service, repo, portRepo } = setup();
    portRepo.findOne.mockResolvedValue({ id: 21, province: { area: 1 } });
    repo.findOne.mockResolvedValue({
      id: 5,
      scope: 'PORT',
      portId: 21,
      area: null,
      version: 4,
      values: { coeff: { clearanceFee: 50 } },
    });

    await expect(
      service.upsertPort(21, { coeff: { clearanceFee: 75 } }, 99, 3),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('can require expectedVersion after the compatibility window', async () => {
    const previous = process.env.EPDA_REQUIRE_EXPECTED_VERSION;
    process.env.EPDA_REQUIRE_EXPECTED_VERSION = 'true';
    try {
      const { service, repo, portRepo } = setup();
      portRepo.findOne.mockResolvedValue({ id: 21, province: { area: 1 } });
      repo.findOne.mockResolvedValue({
        id: 5,
        scope: 'PORT',
        portId: 21,
        area: null,
        version: 4,
        values: { coeff: { clearanceFee: 50 } },
      });

      const error = await service
        .upsertPort(21, { coeff: { clearanceFee: 75 } }, 99)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(428);
      expect(repo.update).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.EPDA_REQUIRE_EXPECTED_VERSION;
      } else {
        process.env.EPDA_REQUIRE_EXPECTED_VERSION = previous;
      }
    }
  });

  it('persists actor and port snapshots in the same audit transaction', async () => {
    const { service, repo, logRepo, portRepo, userRepo } = setup();
    portRepo.findOne.mockResolvedValue({
      id: 21,
      name: 'Chân Mây',
      province: { area: 2 },
    });
    userRepo.findOne.mockResolvedValue({
      id: 99,
      fullName: 'Admin User',
      email: 'admin@example.com',
    });
    repo.findOne.mockResolvedValue(null);
    repo.save.mockImplementation((value: unknown) => Promise.resolve(value));

    await service.upsertPort(21, { coeff: { clearanceFee: 75 } }, 99, null);

    expect(logRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        portName: 'Chân Mây',
        changedByName: 'Admin User',
        changedByEmail: 'admin@example.com',
      }),
    );
  });

  it('fails the PORT transaction when its audit record cannot be persisted', async () => {
    const { service, repo, logRepo, portRepo } = setup();
    portRepo.findOne.mockResolvedValue({ id: 21, province: { area: 1 } });
    repo.findOne.mockResolvedValue(null);
    logRepo.save.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(
      service.upsertPort(21, { coeff: { clearanceFee: 75 } }, 99),
    ).rejects.toThrow('audit unavailable');

    expect(repo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(logRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'PORT',
        portId: 21,
        action: 'UPSERT_PORT',
        changedByUserId: 99,
      }),
    );
  });

  it('derives area from portId and rejects a caller-supplied mismatch', async () => {
    const { service, portRepo } = setup();
    portRepo.findOne.mockResolvedValue({ id: 21, province: { area: 2 } });

    await expect(service.getEffective('1', 21)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('uses the canonical port area when area is omitted', async () => {
    const { service, portRepo } = setup();
    portRepo.findOne.mockResolvedValue({ id: 21, province: { area: 2 } });
    const areaSpy = jest.spyOn(service, 'getAreaSet').mockResolvedValue(null);
    const groupSpy = jest
      .spyOn(service, 'findGroupForPort')
      .mockResolvedValue(null);
    const portSpy = jest
      .spyOn(service, 'getPortOverride')
      .mockResolvedValue(null);

    await service.getEffective(undefined, 21);

    expect(areaSpy).toHaveBeenCalledWith('2');
    expect(groupSpy).toHaveBeenCalledWith('2', 21);
    expect(portSpy).toHaveBeenCalledWith(21);
  });

  it('layers the Chân Mây port override over its canonical middle-area values', async () => {
    const { service, portRepo } = setup();
    portRepo.findOne.mockResolvedValue({ id: 38, province: { area: 2 } });
    jest.spyOn(service, 'getAreaSet').mockResolvedValue({
      id: 1,
      scope: 'AREA',
      area: '2',
      values: { hours: { berthHours: 64 } },
    } as never);
    jest.spyOn(service, 'findGroupForPort').mockResolvedValue(null);
    jest.spyOn(service, 'getPortOverride').mockResolvedValue({
      id: 18,
      scope: 'PORT',
      area: '2',
      portId: 38,
      values: { coeff: { pilotageSingleRate: 0.0045 } },
    } as never);

    const effective = await service.getEffective(undefined, 38);

    expect(effective.hours.berthHours).toBe(64);
    expect(effective.coeff.pilotageSingleRate).toBe(0.0045);
  });

  it('rejects invalid explicit area and port identifiers', async () => {
    const { service } = setup();

    await expect(service.getEffective('UNKNOWN', 21)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.getEffective('MIDDLE', 21)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.getEffective('NORTHERN')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.getEffective('SOUTHERN')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.getEffective(undefined, 0)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each(['MIDDLE', 'NORTHERN', 'SOUTHERN', 'NORTH', 'SOUTH'])(
    'rejects legacy alias %s on direct area and group reads',
    async (area) => {
      const { service } = setup();

      await expect(service.getAreaSet(area)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.listGroups(area)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it('rejects group members that do not exist in the group area', async () => {
    const {
      service,
      repo,
      logRepo,
      userRepo,
      membershipRepo,
      transactionManager,
    } = setup();
    const group = {
      id: 5,
      scope: 'GROUP',
      area: '1',
      memberPortIds: [],
      values: {},
    };
    const transactionalRepo = {
      findOne: jest.fn().mockResolvedValue(group),
      find: jest.fn(),
      save: jest.fn(),
    };
    const transactionalPortRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 21, province: { area: 1 } },
        { id: 22, province: { area: 2 } },
      ]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    transactionManager.getRepository.mockImplementation((entity: unknown) => {
      if (entity === EpdaParameterSet) return transactionalRepo;
      if (entity === EpdaParameterGroupMember) return membershipRepo;
      if (entity === Port) return transactionalPortRepo;
      if (entity === EpdaParameterChangeLog) return logRepo;
      if (entity === User) return userRepo;
      throw new Error('Unexpected transaction repository');
    });

    await expect(service.setGroupMembers(5, [21, 22])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(transactionManager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['epda-group-area:1'],
    );
  });

  it('moves valid same-area members atomically between groups', async () => {
    const {
      service,
      repo,
      logRepo,
      userRepo,
      membershipRepo,
      transactionManager,
    } = setup();
    const group = {
      id: 5,
      scope: 'GROUP',
      area: '1',
      memberPortIds: [],
      version: 1,
      values: {},
    };
    const sibling = {
      id: 6,
      scope: 'GROUP',
      area: '1',
      memberPortIds: [21, 30],
      version: 1,
      values: {},
    };
    const transactionalRepo = {
      findOne: jest.fn().mockResolvedValue(group),
      find: jest.fn().mockResolvedValue([group, sibling]),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
      update: jest
        .fn()
        .mockImplementation(
          (_criteria: unknown, patch: Record<string, unknown>) => {
            Object.assign(group, patch, { version: 2 });
            return Promise.resolve({ affected: 1 });
          },
        ),
    };
    const transactionalPortRepo = {
      find: jest.fn().mockResolvedValue([{ id: 21, province: { area: 1 } }]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    membershipRepo.find
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ groupId: 5, portId: 21 }]);
    transactionManager.getRepository.mockImplementation((entity: unknown) => {
      if (entity === EpdaParameterSet) return transactionalRepo;
      if (entity === EpdaParameterGroupMember) return membershipRepo;
      if (entity === Port) return transactionalPortRepo;
      if (entity === EpdaParameterChangeLog) return logRepo;
      if (entity === User) return userRepo;
      throw new Error('Unexpected transaction repository');
    });

    const saved = await service.setGroupMembers(5, [21]);

    expect(repo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(transactionManager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['epda-group-area:1'],
    );
    expect(membershipRepo.delete).toHaveBeenCalledWith({ groupId: 5 });
    expect(membershipRepo.delete).toHaveBeenCalledWith({
      portId: expect.anything(),
    });
    expect(membershipRepo.save).toHaveBeenCalled();
    expect(saved.memberPortIds).toEqual([21]);
    // JSONB dual-write removed — sibling.memberPortIds is not rewritten.
    expect(sibling.memberPortIds).toEqual([21, 30]);
  });

  it('serializes group creation with membership mutations in the same area', async () => {
    const { service, repo, logRepo, transactionManager } = setup();
    const transactionalRepo = {
      create: jest.fn((value: unknown) => value),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    };
    transactionManager.getRepository.mockImplementation((entity: unknown) =>
      entity === EpdaParameterSet ? transactionalRepo : logRepo,
    );

    await service.createGroup('1', 'North group', {
      coeff: { clearanceFee: 1 },
    });

    expect(repo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(transactionManager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['epda-group-area:1'],
    );
  });

  it('updates only group metadata after re-reading membership behind the area lock', async () => {
    const { service, logRepo, userRepo, membershipRepo, transactionManager } =
      setup();
    const stale = {
      id: 5,
      scope: 'GROUP',
      area: '1',
      name: 'Old',
      memberPortIds: [21],
      values: {},
      version: 1,
    };
    const current = { ...stale, memberPortIds: [21, 22] };
    const transactionalRepo = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(stale)
        .mockResolvedValueOnce(current)
        .mockImplementation(() => Promise.resolve(current)),
      update: jest
        .fn()
        .mockImplementation(
          (_criteria: unknown, patch: Record<string, unknown>) => {
            Object.assign(current, patch, { version: 2 });
            return Promise.resolve({ affected: 1 });
          },
        ),
    };
    membershipRepo.find.mockResolvedValue([
      { groupId: 5, portId: 21 },
      { groupId: 5, portId: 22 },
    ]);
    transactionManager.getRepository.mockImplementation((entity: unknown) => {
      if (entity === EpdaParameterSet) return transactionalRepo;
      if (entity === EpdaParameterGroupMember) return membershipRepo;
      if (entity === EpdaParameterChangeLog) return logRepo;
      if (entity === User) return userRepo;
      throw new Error('Unexpected transaction repository');
    });

    const saved = await service.updateGroup(5, { name: 'Current' });

    expect(transactionManager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['epda-group-area:1'],
    );
    expect(transactionalRepo.update).toHaveBeenCalledWith(
      { id: 5, scope: 'GROUP', version: 1 },
      { name: 'Current' },
    );
    expect(saved.memberPortIds).toEqual([21, 22]);
  });

  it('serializes group deletion with membership mutations in the same area', async () => {
    const { service, logRepo, userRepo, transactionManager } = setup();
    const group = {
      id: 5,
      scope: 'GROUP',
      area: '2',
      memberPortIds: [21],
      values: {},
      version: 1,
    };
    const transactionalRepo = {
      findOne: jest.fn().mockResolvedValue(group),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    transactionManager.getRepository.mockImplementation((entity: unknown) => {
      if (entity === EpdaParameterSet) return transactionalRepo;
      if (entity === EpdaParameterChangeLog) return logRepo;
      if (entity === User) return userRepo;
      throw new Error('Unexpected transaction repository');
    });

    await service.deleteGroup(5);

    expect(transactionManager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['epda-group-area:2'],
    );
    expect(transactionalRepo.delete).toHaveBeenCalledWith({
      id: 5,
      scope: 'GROUP',
      version: 1,
    });
  });
});
