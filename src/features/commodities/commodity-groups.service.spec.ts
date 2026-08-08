import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CommodityGroupsService } from './commodity-groups.service';
import { CommoditiesService } from './commodities.service';
import type { CommodityUsageChecker } from './ports/commodity-usage.checker';

function createGroupsService(overrides: {
  serviceTypes?: Array<{ id: number; name: string; displayName: string }>;
  existingGroup?: Record<string, unknown> | null;
  groupAfterCreate?: Record<string, unknown>;
  commodities?: Array<Record<string, unknown>>;
  /** When looking up by name, return this other group (for 409 rename tests). */
  conflictingGroup?: Record<string, unknown> | null;
  inUse?: boolean;
}) {
  const serviceTypes = overrides.serviceTypes ?? [
    { id: 1, name: 'SHIPPING AGENCY', displayName: 'Shipping Agency' },
    { id: 2, name: 'FREIGHT FORWARDING', displayName: 'Freight Forwarding' },
  ];

  const groupRepository = {
    findOne: jest.fn().mockImplementation(async (args: { where?: { id?: number; serviceTypeId?: number; name?: string }; relations?: unknown }) => {
      if (args?.where?.id != null) {
        if (overrides.existingGroup && (overrides.existingGroup as { id: number }).id === args.where.id) {
          return {
            ...overrides.existingGroup,
            commodities: overrides.commodities ?? [],
          };
        }
        return overrides.existingGroup
          ? { ...overrides.existingGroup, commodities: overrides.commodities ?? [] }
          : null;
      }
      if (args?.where?.name) {
        if (
          overrides.conflictingGroup &&
          overrides.conflictingGroup.name === args.where.name
        ) {
          return overrides.conflictingGroup;
        }
        return overrides.existingGroup?.name === args.where.name
          ? overrides.existingGroup
          : null;
      }
      return null;
    }),
    create: jest.fn().mockImplementation((value) => value),
    save: jest.fn().mockImplementation(async (value: Record<string, unknown>) => {
      if (overrides.existingGroup && value.id === overrides.existingGroup.id) {
        Object.assign(overrides.existingGroup, value);
      }
      return value;
    }),
    createQueryBuilder: jest.fn(),
  };

  const commodityRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((value) => value),
    save: jest.fn().mockImplementation(async (value) => ({
      id: value.id ?? 99,
      ...value,
    })),
    createQueryBuilder: jest.fn().mockReturnValue({
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(overrides.commodities ?? []),
    }),
  };

  const serviceTypeRepository = {
    find: jest.fn().mockResolvedValue(serviceTypes),
  };

  const usageChecker: CommodityUsageChecker = {
    isInUse: jest.fn().mockResolvedValue(overrides.inUse ?? false),
  };

  const commoditiesService = {
    normalizeCargoTypePublic: jest.fn().mockImplementation((v?: string) => {
      if (!v) return 'IN_BULK';
      return v.toUpperCase().replace(/[\s-]+/g, '_');
    }),
    toDto: jest.fn().mockImplementation((item: Record<string, unknown>) => ({
      id: item.id,
      serviceTypeId: item.serviceTypeId,
      groupId: item.groupId ?? null,
      groupName: (item.group as { name?: string } | undefined)?.name ?? null,
      name: item.name,
      displayName: item.displayName,
      description: item.description ?? null,
      requiredImageCount: item.requiredImageCount ?? 18,
      cargoType: item.cargoType ?? 'IN_BULK',
    })),
  };

  const manager = {
    getRepository: jest.fn().mockImplementation((entity: { name?: string }) => {
      if (entity?.name === 'CommodityGroup' || entity === groupRepository) {
        return {
          create: jest.fn().mockImplementation((v) => v),
          save: jest.fn().mockImplementation(async (v) => ({
            id: 10,
            ...v,
            createdAt: new Date('2026-08-07T00:00:00.000Z'),
            updatedAt: new Date('2026-08-07T00:00:00.000Z'),
          })),
          findOneOrFail: jest.fn().mockResolvedValue(
            overrides.groupAfterCreate ?? {
              id: 10,
              serviceTypeId: 2,
              name: 'Foodstuffs',
              commodities: [
                {
                  id: 99,
                  serviceTypeId: 2,
                  groupId: 10,
                  name: 'RICE',
                  displayName: 'Rice',
                  description: null,
                  requiredImageCount: 18,
                  cargoType: 'IN_BULK',
                },
              ],
              createdAt: new Date('2026-08-07T00:00:00.000Z'),
              updatedAt: new Date('2026-08-07T00:00:00.000Z'),
            },
          ),
          delete: jest.fn(),
        };
      }
      return {
        create: jest.fn().mockImplementation((v) => v),
        save: jest.fn().mockImplementation(async (v) => ({ id: 99, ...v })),
        findOne: jest.fn().mockResolvedValue(null),
        delete: jest.fn(),
      };
    }),
  };

  const dataSource = {
    transaction: jest.fn().mockImplementation(async (fn) => fn(manager)),
  };

  const service = new CommodityGroupsService(
    groupRepository as never,
    commodityRepository as never,
    serviceTypeRepository as never,
    usageChecker,
    commoditiesService as unknown as CommoditiesService,
    dataSource as never,
  );

  return {
    service,
    groupRepository,
    commodityRepository,
    usageChecker,
    dataSource,
  };
}

describe('CommodityGroupsService.create', () => {
  it('requires at least one commodity', async () => {
    const { service } = createGroupsService({});

    await expect(
      service.create({
        serviceSlug: 'freight-forwarding',
        name: 'Foodstuffs',
        commodities: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a group with commodities', async () => {
    const { service } = createGroupsService({});

    const created = await service.create({
      serviceSlug: 'freight-forwarding',
      name: 'Foodstuffs',
      commodities: [{ name: 'RICE', displayName: 'Rice' }],
    });

    expect(created.name).toBe('Foodstuffs');
    expect(created.commodities).toHaveLength(1);
    expect(created.commodities[0].displayName).toBe('Rice');
  });
});

describe('CommodityGroupsService.update', () => {
  it('renames a group', async () => {
    const { service, groupRepository } = createGroupsService({
      existingGroup: {
        id: 5,
        serviceTypeId: 2,
        name: 'Foodstuffs',
        createdAt: new Date('2026-08-07T00:00:00.000Z'),
        updatedAt: new Date('2026-08-07T00:00:00.000Z'),
      },
    });

    const updated = await service.update(5, { name: '  Grains  ' });
    expect(updated.name).toBe('Grains');
    expect(groupRepository.save).toHaveBeenCalled();
  });

  it('rejects empty rename', async () => {
    const { service } = createGroupsService({
      existingGroup: {
        id: 5,
        serviceTypeId: 2,
        name: 'Foodstuffs',
      },
    });

    await expect(service.update(5, { name: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('409s when rename collides in the same service', async () => {
    const { service } = createGroupsService({
      existingGroup: {
        id: 5,
        serviceTypeId: 2,
        name: 'Foodstuffs',
      },
      conflictingGroup: {
        id: 9,
        serviceTypeId: 2,
        name: 'Grains',
      },
    });

    await expect(service.update(5, { name: 'Grains' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('CommodityGroupsService.delete', () => {
  it('blocks delete when any member commodity is in use', async () => {
    const { service, dataSource } = createGroupsService({
      existingGroup: {
        id: 5,
        serviceTypeId: 2,
        name: 'Foodstuffs',
      },
      commodities: [
        {
          id: 9,
          name: 'RICE',
          displayName: 'Rice',
          serviceTypeId: 2,
        },
      ],
      inUse: true,
    });

    await expect(service.delete(5)).rejects.toBeInstanceOf(ConflictException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('404s when group is missing', async () => {
    const { service } = createGroupsService({ existingGroup: null });
    await expect(service.delete(404)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CommodityGroupsService.listBookingOptions', () => {
  it('returns FF options with displayLabel shape', async () => {
    const { service } = createGroupsService({
      commodities: [
        {
          id: 7,
          displayName: 'Rice',
          name: 'RICE',
          serviceTypeId: 2,
          group: { id: 3, name: 'Foodstuffs' },
        },
      ],
    });

    const options = await service.listBookingOptions();
    expect(options).toEqual([
      {
        id: 7,
        commodityName: 'Rice',
        groupName: 'Foodstuffs',
        displayLabel: 'Rice IN Foodstuffs',
      },
    ]);
  });
});
