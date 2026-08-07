import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommoditiesService } from './commodities.service';

function createService(overrides: {
  commodity?: Record<string, unknown> | null;
  galleryCount?: number;
  shippingCount?: number;
  freightCount?: number;
  logisticsCount?: number;
  deleteError?: unknown;
}) {
  const commodityRepository = {
    findOne: jest.fn().mockResolvedValue(overrides.commodity ?? null),
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
