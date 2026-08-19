import { ConflictException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import type { Repository } from 'typeorm';
import { CommoditiesAdminController } from './commodities-admin.controller';
import { CommoditiesService } from './commodities.service';
import { CreateCommodityDto } from './dto/create-commodity.dto';
import { Commodity } from './entities/commodity.entity';
import type { CommodityUsageChecker } from './ports/commodity-usage.checker';

const legacyRow: Commodity = {
  id: 9,
  serviceTypeId: 1,
  name: 'WOOD_CHIPS',
  displayName: 'Wood Chips',
  description: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
};

function createSubject(
  options: {
    rows?: Commodity[];
    current?: Commodity | null;
    inUse?: boolean;
    deleteError?: unknown;
  } = {},
) {
  const rows = options.rows ?? [];
  const current = options.current === undefined ? legacyRow : options.current;
  const repository = {
    find: jest
      .fn()
      .mockImplementation(
        (args: { where?: { serviceTypeId?: number } }): Promise<Commodity[]> =>
          Promise.resolve(
            args.where?.serviceTypeId == null
              ? rows
              : rows.filter(
                  (row) => row.serviceTypeId === args.where?.serviceTypeId,
                ),
          ),
      ),
    findOne: jest
      .fn()
      .mockImplementation(
        (args: { where: { id: number } }): Promise<Commodity | null> =>
          Promise.resolve(current?.id === args.where.id ? current : null),
      ),
    createQueryBuilder: jest.fn(),
    create: jest
      .fn()
      .mockImplementation(
        (value: Partial<Commodity>): Commodity => value as Commodity,
      ),
    save: jest.fn().mockImplementation((value: Commodity): Promise<Commodity> =>
      Promise.resolve({
        createdAt: new Date('2026-08-19T00:00:00.000Z'),
        updatedAt: new Date('2026-08-19T00:00:00.000Z'),
        id: value.id ?? 42,
        ...value,
      }),
    ),
    delete: options.deleteError
      ? jest.fn().mockRejectedValue(options.deleteError)
      : jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const isInUse = jest.fn().mockResolvedValue(options.inUse ?? false);
  const usageChecker: CommodityUsageChecker = { isInUse };
  const service = new CommoditiesService(
    repository as unknown as Repository<Commodity>,
    usageChecker,
  );
  return {
    service,
    repository,
    usageChecker,
    isInUse,
    controller: new CommoditiesAdminController(service),
  };
}

describe('CommoditiesService independent admin contract', () => {
  it('reads an independent Commodity row', async () => {
    const { service } = createSubject({ rows: [legacyRow] });
    const result = await service.list({ serviceTypeId: 1 });
    expect(result).toEqual([
      {
        id: 9,
        serviceTypeId: 1,
        name: 'WOOD_CHIPS',
        displayName: 'Wood Chips',
        description: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
    ]);
  });

  it('rejects a normalized duplicate name within one Service', async () => {
    const { service, repository } = createSubject({ rows: [legacyRow] });
    await expect(
      service.create({
        serviceTypeId: 1,
        name: ' wood   chips ',
        displayName: 'Wood Chips',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('allows the same normalized name in another Service', async () => {
    const { service, repository } = createSubject({ rows: [legacyRow] });
    const result = await service.create({
      serviceTypeId: 4,
      name: ' wood   chips ',
      displayName: ' Logistics Wood Chips ',
    });
    expect(repository.create).toHaveBeenCalledWith({
      serviceTypeId: 4,
      name: 'wood chips',
      displayName: 'Logistics Wood Chips',
      description: null,
    });
    expect(result.serviceTypeId).toBe(4);
  });

  it('generates the internal name from displayName when code is omitted', async () => {
    const { service, repository } = createSubject({ rows: [] });
    const result = await service.create({
      serviceTypeId: 1,
      displayName: '  Wood chips & biomass  ',
      description: ' Renewable fuel ',
    });

    expect(repository.create).toHaveBeenCalledWith({
      serviceTypeId: 1,
      name: 'WOOD_CHIPS_BIOMASS',
      displayName: 'Wood chips & biomass',
      description: 'Renewable fuel',
    });
    expect(result.name).toBe('WOOD_CHIPS_BIOMASS');
  });

  it('updates only independent fields', async () => {
    const current = { ...legacyRow };
    const { service, repository } = createSubject({ current, rows: [] });
    const result = await service.update(9, {
      serviceTypeId: 1,
      name: ' BIOMASS ',
      displayName: ' Biomass ',
      description: ' Renewable fuel ',
    });
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'BIOMASS',
        displayName: 'Biomass',
        description: 'Renewable fuel',
      }),
    );
    expect(result).not.toHaveProperty('cargoType');
    expect(result).not.toHaveProperty('requiredImageCount');
  });

  it('preserves the internal name when an update omits code', async () => {
    const current = { ...legacyRow };
    const { service, repository } = createSubject({ current, rows: [] });

    await service.update(9, {
      serviceTypeId: 1,
      displayName: 'Biomass cargo',
      description: 'Renamed in Admin',
    });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'WOOD_CHIPS',
        displayName: 'Biomass cargo',
        description: 'Renamed in Admin',
      }),
    );
  });

  it('rejects a normalized duplicate during update', async () => {
    const duplicate = { ...legacyRow, id: 2, name: ' coal ' };
    const { service } = createSubject({
      current: legacyRow,
      rows: [legacyRow, duplicate],
    });
    await expect(
      service.update(9, {
        serviceTypeId: 1,
        name: 'COAL',
        displayName: 'Coal',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps database uniqueness races to a conflict', async () => {
    const { service, repository } = createSubject({ rows: [] });
    repository.save.mockRejectedValueOnce({ driverError: { code: '23505' } });
    await expect(
      service.create({
        serviceTypeId: 1,
        name: 'COAL',
        displayName: 'Coal',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CreateCommodityDto', () => {
  it('allows the internal name to be omitted for automatic generation', async () => {
    const dto = Object.assign(new CreateCommodityDto(), {
      serviceTypeId: 1,
      displayName: 'Wood Chips',
    });

    await expect(
      validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).resolves.toEqual([]);
  });

  it('forbids Group, Type, cargoType and quota request fields', async () => {
    const dto = Object.assign(new CreateCommodityDto(), {
      serviceTypeId: 1,
      name: 'COAL',
      displayName: 'Coal',
      groupId: 1,
      commodityTypeId: 2,
      cargoType: 'IN_BULK',
      requiredImageCount: 18,
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.map((error) => error.property).sort()).toEqual([
      'cargoType',
      'commodityTypeId',
      'groupId',
      'requiredImageCount',
    ]);
  });
});

describe('CommoditiesService delete compatibility', () => {
  it('passes independent identity data to the usage guard', async () => {
    const { service, isInUse } = createSubject({ current: legacyRow });
    await service.delete(9);
    expect(isInUse).toHaveBeenCalledWith({
      id: 9,
      name: 'WOOD_CHIPS',
      displayName: 'Wood Chips',
    });
  });

  it('404s missing rows and maps FK references to conflict', async () => {
    await expect(
      createSubject({ current: null }).service.delete(9),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      createSubject({
        current: legacyRow,
        deleteError: { driverError: { code: '23503' } },
      }).service.delete(9),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CommoditiesAdminController', () => {
  it('passes the Service-scoped list query through unchanged', async () => {
    const { controller, service } = createSubject();
    const listSpy = jest.spyOn(service, 'list').mockResolvedValue([]);
    await expect(
      controller.list({ serviceTypeId: 4, limit: 25 }),
    ).resolves.toEqual([]);
    expect(listSpy).toHaveBeenCalledWith({ serviceTypeId: 4, limit: 25 });
  });
});
