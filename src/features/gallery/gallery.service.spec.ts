import { GalleryService } from './gallery.service';
import type { Repository } from 'typeorm';
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
