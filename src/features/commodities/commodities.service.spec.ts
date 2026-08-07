import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommoditiesService } from './commodities.service';

function createService(overrides: {
  commodity?: Record<string, unknown> | null;
  duplicate?: Record<string, unknown> | null;
  galleryCount?: number;
  shippingCount?: number;
  freightCount?: number;
  logisticsCount?: number;
  deleteError?: unknown;
}) {
  const findOneResults: Array<Record<string, unknown> | null> = [];
  if (overrides.commodity !== undefined) {
    findOneResults.push(overrides.commodity);
  }
  if (overrides.duplicate !== undefined) {
    findOneResults.push(overrides.duplicate);
  }

  const commodityRepository = {
    findOne: jest.fn().mockImplementation(async () => {
      if (findOneResults.length > 0) {
        return findOneResults.shift() ?? null;
      }
      return overrides.commodity ?? null;
    }),
    create: jest.fn().mockImplementation((value) => value),
    save: jest.fn().mockImplementation(async (value) => ({
      id: value.id ?? 42,
      ...value,
    })),
    delete: jest.fn().mockImplementation(async () => {
      if (overrides.deleteError) throw overrides.deleteError;
    }),
  };

  const countRepo = (count: number) => ({
    count: jest.fn().mockResolvedValue(count),
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(count),
    }),
  });

  const galleryImageRepository = countRepo(overrides.galleryCount ?? 0);
  const shippingAgencyInquiryRepository = countRepo(
    overrides.shippingCount ?? 0,
  );
  const freightForwardingInquiryRepository = countRepo(
    overrides.freightCount ?? 0,
  );
  const totalLogisticsInquiryRepository = countRepo(
    overrides.logisticsCount ?? 0,
  );

  const service = new CommoditiesService(
    commodityRepository as never,
    galleryImageRepository as never,
    shippingAgencyInquiryRepository as never,
    freightForwardingInquiryRepository as never,
    totalLogisticsInquiryRepository as never,
  );

  return {
    service,
    commodityRepository,
    galleryImageRepository,
  };
}

describe('CommoditiesService.create', () => {
  it('rejects duplicate name within the same service type and cargo type', async () => {
    const { service, commodityRepository } = createService({
      duplicate: {
        id: 1,
        name: 'WOOD_CHIPS',
        cargoType: 'IN_BULK',
        serviceTypeId: 1,
      },
    });

    await expect(
      service.create({
        serviceTypeId: 1,
        name: 'WOOD_CHIPS',
        displayName: 'Wood Chips',
        cargoType: 'IN_BULK',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(commodityRepository.findOne).toHaveBeenCalledWith({
      where: {
        serviceTypeId: 1,
        cargoType: 'IN_BULK',
        name: 'WOOD_CHIPS',
      },
    });
    expect(commodityRepository.save).not.toHaveBeenCalled();
  });

  it('allows the same name under a different cargo type', async () => {
    const { service, commodityRepository } = createService({
      duplicate: null,
    });

    const created = await service.create({
      serviceTypeId: 1,
      name: 'WOOD_CHIPS',
      displayName: 'Wood Chips',
      cargoType: 'IN_BAG_PACK',
    });

    expect(commodityRepository.findOne).toHaveBeenCalledWith({
      where: {
        serviceTypeId: 1,
        cargoType: 'IN_BAG_PACK',
        name: 'WOOD_CHIPS',
      },
    });
    expect(created.name).toBe('WOOD_CHIPS');
    expect(created.cargoType).toBe('IN_BAG_PACK');
  });
});

describe('CommoditiesService.update', () => {
  const existing = {
    id: 9,
    name: 'WOOD_CHIPS',
    displayName: 'Wood Chips',
    serviceTypeId: 1,
    cargoType: 'IN_BULK',
    requiredImageCount: 18,
    description: null,
  };

  it('rejects rename that collides within the same cargo type', async () => {
    const { service, commodityRepository } = createService({
      commodity: existing,
      duplicate: {
        id: 3,
        name: 'COAL',
        cargoType: 'IN_BULK',
        serviceTypeId: 1,
      },
    });

    await expect(
      service.update(9, {
        serviceTypeId: 1,
        name: 'COAL',
        displayName: 'Coal',
        cargoType: 'IN_BULK',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(commodityRepository.findOne).toHaveBeenNthCalledWith(2, {
      where: {
        serviceTypeId: 1,
        cargoType: 'IN_BULK',
        name: 'COAL',
      },
    });
    expect(commodityRepository.save).not.toHaveBeenCalled();
  });

  it('allows rename to a name that only exists under another cargo type', async () => {
    const { service, commodityRepository } = createService({
      commodity: existing,
      duplicate: null,
    });

    const updated = await service.update(9, {
      serviceTypeId: 1,
      name: 'COAL',
      displayName: 'Coal',
      cargoType: 'IN_BULK',
    });

    expect(commodityRepository.findOne).toHaveBeenNthCalledWith(2, {
      where: {
        serviceTypeId: 1,
        cargoType: 'IN_BULK',
        name: 'COAL',
      },
    });
    expect(updated.name).toBe('COAL');
    expect(commodityRepository.save).toHaveBeenCalled();
  });
});

describe('CommoditiesService.delete', () => {
  const commodity = {
    id: 9,
    name: 'WOOD_CHIPS',
    displayName: 'Wood Chips',
    serviceTypeId: 1,
  };

  it('hard-deletes when the commodity is unused', async () => {
    const { service, commodityRepository } = createService({ commodity });

    await service.delete(9);

    expect(commodityRepository.delete).toHaveBeenCalledWith(9);
  });

  it('404s when the commodity does not exist', async () => {
    const { service } = createService({ commodity: null });

    await expect(service.delete(9)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks delete when gallery images reference the commodity', async () => {
    const { service, commodityRepository } = createService({
      commodity,
      galleryCount: 2,
    });

    await expect(service.delete(9)).rejects.toThrow(
      CommoditiesService.IN_USE_MESSAGE,
    );
    expect(commodityRepository.delete).not.toHaveBeenCalled();
  });

  it('blocks delete when a shipping-agency inquiry uses the cargo name', async () => {
    const { service, commodityRepository } = createService({
      commodity,
      shippingCount: 1,
    });

    await expect(service.delete(9)).rejects.toBeInstanceOf(ConflictException);
    expect(commodityRepository.delete).not.toHaveBeenCalled();
  });

  it('maps FK violations to a conflict in-use message', async () => {
    const { service } = createService({
      commodity,
      deleteError: { driverError: { code: '23503' } },
    });

    await expect(service.delete(9)).rejects.toThrow(
      CommoditiesService.IN_USE_MESSAGE,
    );
  });
});
