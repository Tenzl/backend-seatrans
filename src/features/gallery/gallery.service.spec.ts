import { GalleryService } from './gallery.service';
import type { DataSource, Repository } from 'typeorm';
import { GalleryImage } from './entities/gallery-image.entity';
import { Commodity } from '../commodities/entities/commodity.entity';
import { Province } from '../provinces/entities/province.entity';
import { Port } from '../ports/entities/port.entity';
import { CloudinaryService } from '../../shared/services/cloudinary.service';

describe('GalleryService search pagination (DB-03)', () => {
  it('always applies take/skip when q is present (no unbounded getMany)', async () => {
    const qb = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      getMany: jest.fn(),
    };
    const galleryRepository = {
      createQueryBuilder: jest.fn(() => qb),
    };

    const service = new GalleryService(
      galleryRepository as unknown as Repository<GalleryImage>,
      {} as Repository<Commodity>,
      {} as Repository<Province>,
      {} as Repository<Port>,
      {} as CloudinaryService,
      {} as DataSource,
    );

    await service.getPublicPaged({ q: 'coal%', page: 2, size: 20 });

    expect(qb.skip).toHaveBeenCalledWith(40);
    expect(qb.take).toHaveBeenCalledWith(20);
    expect(qb.getManyAndCount).toHaveBeenCalled();
    expect(qb.getMany).not.toHaveBeenCalled();
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("ESCAPE E'\\\\'"),
      { q: '%coal\\%%' },
    );
  });
});

describe('GalleryService independent Commodity Type contract', () => {
  it('accepts an arbitrary same-Service Type and Commodity pair', async () => {
    const { service, galleryRepository } = createGallerySubject({
      commodityServiceTypeId: 2,
      typeServiceTypeId: 2,
    });

    const result = await service.saveImageFromUrl(
      {
        imageUrl: 'https://example.test/image.jpg',
        serviceTypeId: 2,
        commodityId: 10,
        commodityTypeId: 20,
        provinceId: 30,
        portId: 40,
      },
      7,
    );

    expect(galleryRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceTypeId: 2,
        commodityId: 10,
        commodityTypeId: 20,
      }),
    );
    expect(result.commodityTypeId).toBe(20);
  });

  it.each([
    ['Commodity', { commodityServiceTypeId: 3, typeServiceTypeId: 2 }],
    ['Commodity Type', { commodityServiceTypeId: 2, typeServiceTypeId: 3 }],
  ])('rejects cross-Service %s independently', async (_label, options) => {
    const { service } = createGallerySubject(options);
    await expect(
      service.saveImageFromUrl(
        {
          imageUrl: 'https://example.test/image.jpg',
          serviceTypeId: 2,
          commodityId: 10,
          commodityTypeId: 20,
          provinceId: 30,
          portId: 40,
        },
        7,
      ),
    ).rejects.toThrow(/Service/i);
  });

  it('serializes a legacy image with null Commodity Type', async () => {
    const { service } = createGallerySubject({ legacyNullType: true });
    const result = await service.getById(1);
    expect(result.commodityTypeId).toBeNull();
    expect(result.commodityTypeName).toBeNull();
  });

  it('filters Commodity Type without adding a Commodity pairing predicate', async () => {
    const { service, qb } = createGallerySubject();
    await service.getPublicPaged({ commodityTypeId: 20 });
    expect(qb.andWhere).toHaveBeenCalledWith(
      'gallery.commodity_type_id = :commodityTypeId',
      { commodityTypeId: 20 },
    );
    expect(qb.andWhere).not.toHaveBeenCalledWith(
      expect.stringMatching(/commodity_id.*commodity_type_id/i),
      expect.anything(),
    );
  });
});

function createGallerySubject(
  options: {
    commodityServiceTypeId?: number;
    typeServiceTypeId?: number;
    legacyNullType?: boolean;
  } = {},
) {
  const commodity = {
    id: 10,
    serviceTypeId: options.commodityServiceTypeId ?? 2,
    name: 'PKE',
    displayName: 'PKE',
  } as Commodity;
  const commodityType = options.legacyNullType
    ? null
    : {
        id: 20,
        serviceTypeId: options.typeServiceTypeId ?? 2,
        code: 'IN_BULK',
        name: 'Bulk',
      };
  const image = {
    id: 1,
    imageUrl: 'https://example.test/image.jpg',
    cloudinaryPublicId: null,
    uploadedAt: new Date(),
    uploadedById: 7,
    serviceTypeId: 2,
    commodityId: 10,
    commodity,
    commodityTypeId: commodityType?.id ?? null,
    commodityType,
    provinceCode: '01',
    province: { id: 30, name: 'Province' },
    port: { id: 40, name: 'Port' },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as GalleryImage;
  const qb = {
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  };
  const galleryRepository = {
    createQueryBuilder: jest.fn(() => qb),
    findOne: jest.fn().mockResolvedValue(image),
    create: jest
      .fn()
      .mockImplementation((value: Partial<GalleryImage>): GalleryImage => ({
        ...image,
        ...value,
      })),
    save: jest
      .fn()
      .mockImplementation((value: GalleryImage) => Promise.resolve(value)),
  };
  const commodityRepository = {
    findOne: jest.fn().mockResolvedValue(commodity),
  };
  const provinceRepository = {
    findOne: jest
      .fn()
      .mockResolvedValue({ id: 30, name: 'Province', code: '01' }),
  };
  const portRepository = {
    findOne: jest.fn().mockResolvedValue({ id: 40, name: 'Port' }),
  };
  const dataSource = {
    getRepository: jest.fn().mockReturnValue({
      findOne: jest.fn().mockResolvedValue(commodityType),
    }),
  };
  const ServiceConstructor = GalleryService as unknown as new (
    ...args: unknown[]
  ) => GalleryService;
  const service = new ServiceConstructor(
    galleryRepository,
    commodityRepository,
    provinceRepository,
    portRepository,
    {},
    dataSource,
  );
  return { service, galleryRepository, qb };
}
