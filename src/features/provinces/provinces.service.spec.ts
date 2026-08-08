import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProvincesService } from './provinces.service';
import { Province } from './entities/province.entity';
import { ShortTtlCacheService } from '../../shared/redis/short-ttl-cache.service';

describe('ProvincesService', () => {
  let service: ProvincesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProvincesService,
        { provide: getRepositoryToken(Province), useValue: {} },
        {
          provide: ShortTtlCacheService,
          useValue: {
            isEnabled: () => false,
            getJson: async () => null,
            setJson: async () => undefined,
            deleteByPrefix: async () => undefined,
          },
        },
      ],
    }).compile();

    service = module.get<ProvincesService>(ProvincesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
