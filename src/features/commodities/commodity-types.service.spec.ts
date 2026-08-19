import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import type { Repository } from 'typeorm';
import { CommodityTypesAdminController } from './commodity-types-admin.controller';
import { CommodityTypesService } from './commodity-types.service';
import { CommodityType } from './entities/commodity-type.entity';
import { ServiceType } from '../logistics/entities/service-type.entity';
import {
  CreateCommodityTypeDto,
  UpdateCommodityTypeDto,
} from './dto/commodity-type.dto';

type TypeRow = Partial<CommodityType> &
  Pick<CommodityType, 'id' | 'serviceTypeId' | 'name'>;

function typeRow(overrides: Partial<TypeRow> = {}): TypeRow {
  return {
    id: 1,
    serviceTypeId: 2,
    code: 'IN_BULK',
    name: 'Bulk',
    createdAt: new Date('2026-08-19T00:00:00.000Z'),
    updatedAt: new Date('2026-08-19T00:00:00.000Z'),
    ...overrides,
  };
}

function createSubject(
  options: {
    service?: Partial<ServiceType> | null;
    types?: TypeRow[];
    current?: TypeRow | null;
    deleteError?: unknown;
    typeInUse?: boolean;
  } = {},
) {
  const rows = options.types ?? [];
  const current = options.current === undefined ? null : options.current;
  const typeRepository = {
    find: jest.fn().mockResolvedValue(rows),
    findOneBy: jest
      .fn()
      .mockImplementation(({ id }: { id: number }): Promise<TypeRow | null> =>
        Promise.resolve(current?.id === id ? current : null),
      ),
    findOne: jest
      .fn()
      .mockImplementation(
        ({
          where: { id },
        }: {
          where: { id: number };
        }): Promise<TypeRow | null> =>
          Promise.resolve(
            current?.id === id
              ? {
                  id: current.id,
                  serviceTypeId: current.serviceTypeId,
                  name: current.name,
                  createdAt: current.createdAt,
                  updatedAt: current.updatedAt,
                }
              : null,
          ),
      ),
    create: jest
      .fn()
      .mockImplementation(
        (value: Partial<CommodityType>): CommodityType =>
          value as CommodityType,
      ),
    save: jest
      .fn()
      .mockImplementation((value: CommodityType): Promise<CommodityType> =>
        Promise.resolve(
          typeRow({ id: value.id ?? 99, ...value }) as CommodityType,
        ),
      ),
    delete: options.deleteError
      ? jest.fn().mockRejectedValue(options.deleteError)
      : jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const serviceTypeRepository = {
    findOneBy: jest
      .fn()
      .mockImplementation(
        ({ id }: { id: number }): Promise<Partial<ServiceType> | null> =>
          Promise.resolve(
            options.service === undefined
              ? { id, name: `SERVICE ${id}`, isActive: true }
              : options.service,
          ),
      ),
  };
  const usageChecker = {
    isInUse: jest.fn().mockResolvedValue(false),
    isTypeInUse: jest.fn().mockResolvedValue(options.typeInUse ?? false),
  };
  const service = new CommodityTypesService(
    typeRepository as unknown as Repository<CommodityType>,
    serviceTypeRepository as unknown as Repository<ServiceType>,
    undefined,
    usageChecker,
  );
  return {
    service,
    controller: new CommodityTypesAdminController(service),
    typeRepository,
    serviceTypeRepository,
    usageChecker,
  };
}

describe('CommodityTypesService', () => {
  it('lists one Service scope and never exposes a Commodity collection', async () => {
    const { service, typeRepository } = createSubject({
      types: [typeRow()],
    });

    const result = await service.list({ serviceTypeId: 2 });

    expect(typeRepository.find).toHaveBeenCalledWith({
      where: { serviceTypeId: 2 },
      order: { name: 'ASC', id: 'ASC' },
      select: {
        id: true,
        serviceTypeId: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(result).toEqual([
      {
        id: 1,
        serviceTypeId: 2,
        name: 'Bulk',
        createdAt: '2026-08-19T00:00:00.000Z',
        updatedAt: '2026-08-19T00:00:00.000Z',
      },
    ]);
    expect(result[0]).not.toHaveProperty('code');
    expect(result[0]).not.toHaveProperty('commodities');
  });

  it('creates a Type with only a collapsed display name and writes no code', async () => {
    const { service, typeRepository } = createSubject();

    const result = await service.create({
      serviceTypeId: 2,
      name: ' Project   Cargo ',
    });

    expect(typeRepository.create).toHaveBeenCalledWith({
      serviceTypeId: 2,
      name: 'Project Cargo',
    });
    expect(result).not.toHaveProperty('code');
  });

  it('supports a Service outside the two legacy Commodity admin scopes', async () => {
    const { service, serviceTypeRepository } = createSubject();

    const result = await service.create({
      serviceTypeId: 4,
      name: 'Warehousing',
    });

    expect(serviceTypeRepository.findOneBy).toHaveBeenCalledWith({ id: 4 });
    expect(result.serviceTypeId).toBe(4);
  });

  it('rejects a normalized duplicate name in one Service', async () => {
    const duplicate = typeRow({ name: ' project   cargo ' });
    const { service, typeRepository } = createSubject({ types: [duplicate] });
    typeRepository.find.mockResolvedValue([duplicate]);

    await expect(
      service.create({ serviceTypeId: 2, name: 'Project Cargo' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a missing or inactive Service', async () => {
    const { service } = createSubject({ service: null });

    await expect(
      service.create({ serviceTypeId: 404, name: 'Bulk' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates name only and never returns or writes code', async () => {
    const current = typeRow({ code: undefined });
    const { service, typeRepository } = createSubject({ current });

    const result = await service.update(1, {
      serviceTypeId: 2,
      name: 'Dry Bulk',
    });

    expect(typeRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Dry Bulk' }),
    );
    const saveCalls = typeRepository.save.mock.calls as unknown[][];
    expect(saveCalls[0]?.[0]).not.toHaveProperty('code');
    expect(result).not.toHaveProperty('code');
  });

  it('rejects a normalized duplicate when updating', async () => {
    const current = typeRow();
    const other = typeRow({ id: 2, name: 'Bag Pack' });
    const { service } = createSubject({ current, types: [current, other] });

    await expect(
      service.update(1, { serviceTypeId: 2, name: ' bag   pack ' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects update through the wrong Service scope', async () => {
    const { service } = createSubject({ current: typeRow() });

    await expect(
      service.update(1, { serviceTypeId: 3, name: 'Bulk' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps an in-use FK delete failure to a stable conflict', async () => {
    const { service } = createSubject({
      current: typeRow(),
      deleteError: { driverError: { code: '23503' } },
    });

    await expect(service.delete(1, 2)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects an in-use Type before repository delete', async () => {
    const { service, typeRepository, usageChecker } = createSubject({
      current: typeRow(),
      typeInUse: true,
    });

    await expect(service.delete(1, 2)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(usageChecker.isTypeInUse).toHaveBeenCalledWith({
      id: 1,
      name: 'Bulk',
    });
    expect(typeRepository.delete).not.toHaveBeenCalled();
  });

  it('deletes an unused Type inside the requested Service scope', async () => {
    const { service, typeRepository } = createSubject({ current: typeRow() });

    await expect(service.delete(1, 2)).resolves.toBeUndefined();
    expect(typeRepository.delete).toHaveBeenCalledWith(1);
  });

  it('404s when the Type does not exist', async () => {
    const { service } = createSubject({ current: null });
    await expect(service.delete(404, 2)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('Commodity Type DTO code-free boundary', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it.each([
    [
      CreateCommodityTypeDto,
      { serviceTypeId: 2, name: 'Bulk', code: 'IN_BULK' },
    ],
    [
      UpdateCommodityTypeDto,
      { serviceTypeId: 2, name: 'Bulk', code: 'IN_BULK' },
    ],
  ])('rejects legacy code in %p', async (metatype, value) => {
    await expect(
      pipe.transform(value, { type: 'body', metatype }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts create/update name-only payloads', async () => {
    await expect(
      pipe.transform(
        { serviceTypeId: 2, name: 'Bulk' },
        { type: 'body', metatype: CreateCommodityTypeDto },
      ),
    ).resolves.toEqual(
      expect.objectContaining({ serviceTypeId: 2, name: 'Bulk' }),
    );
    await expect(
      pipe.transform(
        { serviceTypeId: 2, name: 'Dry Bulk' },
        { type: 'body', metatype: UpdateCommodityTypeDto },
      ),
    ).resolves.toEqual(
      expect.objectContaining({ serviceTypeId: 2, name: 'Dry Bulk' }),
    );
  });
});

describe('CommodityTypesAdminController', () => {
  it('delegates scoped CRUD without touching Group endpoints', async () => {
    const { controller, service } = createSubject({ current: typeRow() });
    const listSpy = jest.spyOn(service, 'list').mockResolvedValue([]);
    const deleteSpy = jest.spyOn(service, 'delete').mockResolvedValue();

    await expect(controller.list({ serviceTypeId: 2 })).resolves.toEqual([]);
    await expect(controller.remove('1', { serviceTypeId: 2 })).resolves.toBe(
      undefined,
    );
    expect(listSpy).toHaveBeenCalledWith({ serviceTypeId: 2 });
    expect(deleteSpy).toHaveBeenCalledWith(1, 2);
  });
});
