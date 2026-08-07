import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GalleryImage } from '../gallery/entities/gallery-image.entity';
import { FreightForwardingInquiryEntity } from '../inquiry/entities/freight-forwarding-inquiry.entity';
import { ShippingAgencyInquiryEntity } from '../inquiry/entities/shipping-agency-inquiry.entity';
import { TotalLogisticsInquiryEntity } from '../inquiry/entities/total-logistics-inquiry.entity';
import { Commodity } from './entities/commodity.entity';
import { CommodityDto } from './dto/commodity.dto';
import { CreateCommodityDto } from './dto/create-commodity.dto';
import { ListCommoditiesQueryDto } from './dto/list-commodities-query.dto';

@Injectable()
export class CommoditiesService {
  private static readonly DEFAULT_LIST_LIMIT = 100;
  static readonly IN_USE_MESSAGE =
    'Commodity is currently in use / đang được sử dụng';

  constructor(
    @InjectRepository(Commodity)
    private readonly commodityRepository: Repository<Commodity>,
    @InjectRepository(GalleryImage)
    private readonly galleryImageRepository: Repository<GalleryImage>,
    @InjectRepository(ShippingAgencyInquiryEntity)
    private readonly shippingAgencyInquiryRepository: Repository<ShippingAgencyInquiryEntity>,
    @InjectRepository(FreightForwardingInquiryEntity)
    private readonly freightForwardingInquiryRepository: Repository<FreightForwardingInquiryEntity>,
    @InjectRepository(TotalLogisticsInquiryEntity)
    private readonly totalLogisticsInquiryRepository: Repository<TotalLogisticsInquiryEntity>,
  ) {}

  /**
   * List commodities with optional filters.
   * Search (`q`) returns the full matching set (no limit slice).
   */
  async list(query: ListCommoditiesQueryDto = {}): Promise<CommodityDto[]> {
    const search = query.q?.trim();
    const serviceTypeId = query.serviceTypeId;

    if (search) {
      const qb = this.commodityRepository
        .createQueryBuilder('commodity')
        .where(
          '(LOWER(commodity.name) LIKE :query OR LOWER(commodity.display_name) LIKE :query)',
          { query: `%${search.toLowerCase()}%` },
        )
        .orderBy('commodity.name', 'ASC');

      if (serviceTypeId != null) {
        qb.andWhere('commodity.service_type_id = :serviceTypeId', {
          serviceTypeId,
        });
      }

      return (await qb.getMany()).map((item) => this.toDto(item));
    }

    const commodities = await this.commodityRepository.find({
      where: serviceTypeId != null ? { serviceTypeId } : {},
      order: { name: 'ASC' },
    });

    return commodities
      .slice(0, this.sanitizeLimit(query.limit ?? CommoditiesService.DEFAULT_LIST_LIMIT))
      .map((item) => this.toDto(item));
  }

  async getById(id: number): Promise<CommodityDto> {
    const commodity = await this.commodityRepository.findOne({ where: { id } });
    if (!commodity) {
      throw new NotFoundException('Commodity not found');
    }
    return this.toDto(commodity);
  }

  async create(dto: CreateCommodityDto): Promise<CommodityDto> {
    const normalizedName = dto.name?.trim();
    const normalizedDisplayName = dto.displayName?.trim();
    if (!normalizedName || !normalizedDisplayName) {
      throw new BadRequestException(
        'Commodity name and displayName are required',
      );
    }

    const cargoType = this.normalizeCargoType(dto.cargoType);
    const duplicate = await this.commodityRepository.findOne({
      where: {
        serviceTypeId: dto.serviceTypeId,
        cargoType,
        name: normalizedName,
      },
    });

    if (duplicate) {
      throw new ConflictException(
        'Commodity already exists in this service type and cargo type',
      );
    }

    const commodity = this.commodityRepository.create({
      serviceTypeId: dto.serviceTypeId,
      name: normalizedName,
      displayName: normalizedDisplayName,
      description: dto.description?.trim() || null,
      requiredImageCount: dto.requiredImageCount ?? 18,
      cargoType,
    });

    const saved = await this.commodityRepository.save(commodity);
    return this.toDto(saved);
  }

  async update(id: number, dto: CreateCommodityDto): Promise<CommodityDto> {
    const commodity = await this.commodityRepository.findOne({ where: { id } });
    if (!commodity) {
      throw new NotFoundException('Commodity not found');
    }

    const normalizedName = dto.name?.trim();
    const normalizedDisplayName = dto.displayName?.trim();
    if (!normalizedName || !normalizedDisplayName) {
      throw new BadRequestException(
        'Commodity name and displayName are required',
      );
    }

    // Only re-validate when a cargo type is explicitly sent. Editing a legacy
    // commodity (junk stored type) without touching it keeps its value as-is
    // rather than failing the save.
    const cargoType =
      dto.cargoType !== undefined
        ? this.normalizeCargoType(dto.cargoType)
        : commodity.cargoType;

    const duplicate = await this.commodityRepository.findOne({
      where: {
        serviceTypeId: dto.serviceTypeId,
        cargoType,
        name: normalizedName,
      },
    });

    if (duplicate && duplicate.id !== id) {
      throw new ConflictException(
        'Commodity already exists in this service type and cargo type',
      );
    }

    commodity.serviceTypeId = dto.serviceTypeId;
    commodity.name = normalizedName;
    commodity.displayName = normalizedDisplayName;
    commodity.description = dto.description?.trim() || null;
    commodity.requiredImageCount =
      dto.requiredImageCount ?? commodity.requiredImageCount;
    if (dto.cargoType !== undefined) {
      commodity.cargoType = cargoType;
    }

    const updated = await this.commodityRepository.save(commodity);
    return this.toDto(updated);
  }

  async delete(id: number): Promise<void> {
    const commodity = await this.commodityRepository.findOne({ where: { id } });
    if (!commodity) {
      throw new NotFoundException('Commodity not found');
    }

    await this.assertNotInUse(commodity);

    try {
      await this.commodityRepository.delete(id);
    } catch (error) {
      const databaseCode = (error as { driverError?: { code?: string } } | null)
        ?.driverError?.code;
      if (databaseCode === '23503') {
        throw new ConflictException(CommoditiesService.IN_USE_MESSAGE);
      }
      throw error;
    }
  }

  private async assertNotInUse(commodity: Commodity): Promise<void> {
    const galleryCount = await this.galleryImageRepository.count({
      where: { commodityId: commodity.id },
    });
    if (galleryCount > 0) {
      throw new ConflictException(CommoditiesService.IN_USE_MESSAGE);
    }

    const nameKeys = this.usageNameKeys(commodity);
    if (nameKeys.length === 0) {
      return;
    }

    const shippingCount = await this.shippingAgencyInquiryRepository
      .createQueryBuilder('inquiry')
      .where('LOWER(inquiry.cargo_name) IN (:...names)', { names: nameKeys })
      .getCount();
    if (shippingCount > 0) {
      throw new ConflictException(CommoditiesService.IN_USE_MESSAGE);
    }

    const freightCount = await this.freightForwardingInquiryRepository
      .createQueryBuilder('inquiry')
      .where('LOWER(inquiry.cargo_name) IN (:...names)', { names: nameKeys })
      .getCount();
    if (freightCount > 0) {
      throw new ConflictException(CommoditiesService.IN_USE_MESSAGE);
    }

    const logisticsCount = await this.totalLogisticsInquiryRepository
      .createQueryBuilder('inquiry')
      .where('LOWER(inquiry.cargo_name) IN (:...names)', { names: nameKeys })
      .getCount();
    if (logisticsCount > 0) {
      throw new ConflictException(CommoditiesService.IN_USE_MESSAGE);
    }
  }

  private usageNameKeys(commodity: Commodity): string[] {
    return [...new Set([commodity.name, commodity.displayName])]
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));
  }

  private toDto(item: Commodity): CommodityDto {
    return {
      id: item.id,
      serviceTypeId: item.serviceTypeId,
      name: item.name,
      displayName: item.displayName,
      description: item.description,
      requiredImageCount: item.requiredImageCount,
      cargoType: item.cargoType,
    };
  }

  /** Cargo types are a FIXED set — anything else is rejected (no more junk types). */
  private static readonly ALLOWED_CARGO_TYPES = [
    'IN_BULK',
    'IN_BAG_PACK',
    'IN_EQUIPMENT',
  ];

  /**
   * Canonicalize a cargo type to one of the three allowed codes. Common legacy
   * variants are mapped; anything outside the set is rejected so values like
   * "BREAK BULK" / "PROJECT CARGO" can never be persisted again.
   */
  private normalizeCargoType(value?: string): string {
    const raw = value?.trim();
    if (!raw) return 'IN_BULK';

    const key = raw.toUpperCase().replace(/[\s-]+/g, '_');
    const mapped =
      key === 'BULK' || key === 'INBULK'
        ? 'IN_BULK'
        : key === 'EQUIPMENT' || key === 'INEQUIPMENT'
          ? 'IN_EQUIPMENT'
          : ['IN_BAGS', 'INBAGS', 'BAG_PACK', 'BAGPACK', 'INBAGPACK'].includes(
                key,
              )
            ? 'IN_BAG_PACK'
            : key;

    if (!CommoditiesService.ALLOWED_CARGO_TYPES.includes(mapped)) {
      throw new BadRequestException(
        `Invalid cargo type "${value}". Allowed: ${CommoditiesService.ALLOWED_CARGO_TYPES.join(', ')}`,
      );
    }
    return mapped;
  }

  private sanitizeLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) {
      return CommoditiesService.DEFAULT_LIST_LIMIT;
    }
    return Math.min(limit, CommoditiesService.DEFAULT_LIST_LIMIT);
  }
}
