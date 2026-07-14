import { BadRequestException } from '@nestjs/common';
import { EpdaParametersService } from './epda-parameters.service';
import { EpdaParameterSet } from './entities/epda-parameter-set.entity';
import { EpdaParameterChangeLog } from './entities/epda-parameter-change-log.entity';
import { Port } from '../ports/entities/port.entity';

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
      delete: jest.fn(),
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
    transactionManager.getRepository.mockImplementation((entity: unknown) => {
      if (entity === EpdaParameterSet) return repo;
      if (entity === EpdaParameterChangeLog) return logRepo;
      if (entity === Port) return portRepo;
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
    repo.findOne.mockResolvedValue({
      id: 5,
      scope: 'PORT',
      portId: 21,
      area: '1',
      values: { coeff: { clearanceFee: 50, navigationPerGrt: 0.1 } },
    });

    const saved = await service.upsertPort(21, {
      coeff: { clearanceFee: 75 },
    });

    expect(saved.values).toEqual({ coeff: { clearanceFee: 75 } });
    expect(saved.values.coeff).not.toHaveProperty('navigationPerGrt');
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
    const { service, repo, transactionManager } = setup();
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
    };
    transactionManager.getRepository
      .mockReturnValueOnce(transactionalRepo)
      .mockReturnValueOnce(transactionalPortRepo);

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
    const { service, repo, transactionManager } = setup();
    const group = {
      id: 5,
      scope: 'GROUP',
      area: '1',
      memberPortIds: [],
      values: {},
    };
    const sibling = {
      id: 6,
      scope: 'GROUP',
      area: '1',
      memberPortIds: [21, 30],
      values: {},
    };
    const transactionalRepo = {
      findOne: jest.fn().mockResolvedValue(group),
      find: jest.fn().mockResolvedValue([group, sibling]),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    };
    const transactionalPortRepo = {
      find: jest.fn().mockResolvedValue([{ id: 21, province: { area: 1 } }]),
    };
    transactionManager.getRepository
      .mockReturnValueOnce(transactionalRepo)
      .mockReturnValueOnce(transactionalPortRepo);

    const saved = await service.setGroupMembers(5, [21]);

    expect(repo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(transactionManager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['epda-group-area:1'],
    );
    expect(sibling.memberPortIds).toEqual([30]);
    expect(saved.memberPortIds).toEqual([21]);
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
    const { service, logRepo, transactionManager } = setup();
    const stale = {
      id: 5,
      scope: 'GROUP',
      area: '1',
      name: 'Old',
      memberPortIds: [21],
      values: {},
    };
    const current = { ...stale, memberPortIds: [21, 22] };
    const transactionalRepo = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(stale)
        .mockResolvedValueOnce(current),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    transactionManager.getRepository.mockImplementation((entity: unknown) =>
      entity === EpdaParameterSet ? transactionalRepo : logRepo,
    );

    const saved = await service.updateGroup(5, { name: 'Current' });

    expect(transactionManager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['epda-group-area:1'],
    );
    expect(transactionalRepo.update).toHaveBeenCalledWith(
      { id: 5, scope: 'GROUP' },
      { name: 'Current' },
    );
    expect(saved.memberPortIds).toEqual([21, 22]);
  });

  it('serializes group deletion with membership mutations in the same area', async () => {
    const { service, logRepo, transactionManager } = setup();
    const group = {
      id: 5,
      scope: 'GROUP',
      area: '2',
      memberPortIds: [21],
      values: {},
    };
    const transactionalRepo = {
      findOne: jest.fn().mockResolvedValue(group),
      delete: jest.fn(),
    };
    transactionManager.getRepository.mockImplementation((entity: unknown) =>
      entity === EpdaParameterSet ? transactionalRepo : logRepo,
    );

    await service.deleteGroup(5);

    expect(transactionManager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['epda-group-area:2'],
    );
    expect(transactionalRepo.delete).toHaveBeenCalledWith({
      id: 5,
      scope: 'GROUP',
    });
  });
});
