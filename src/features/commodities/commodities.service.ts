import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Commodity } from './entities/commodity.entity';
import { CommodityDto } from './dto/commodity.dto';
import { CreateCommodityDto } from './dto/create-commodity.dto';
import { ListCommoditiesQueryDto } from './dto/list-commodities-query.dto';
import {
  COMMODITY_USAGE_CHECKER,
  type CommodityUsageChecker,
} from './ports/commodity-usage.checker';

@Injectable()
export class CommoditiesService {
  private static readonly DEFAULT_LIST_LIMIT = 100;
  static readonly IN_USE_MESSAGE =
    'Commodity is currently in use / đang được sử dụng';

  constructor(
    @InjectRepository(Commodity)
    private readonly commodityRepository: Repository<Commodity>,
    @Inject(COMMODITY_USAGE_CHECKER)
    private readonly usageChecker: CommodityUsageChecker,
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
        .leftJoinAndSelect('commodity.group', 'grp')
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
      relations: { group: true },
      order: { name: 'ASC' },
    });

    return commodities
      .slice(0, this.sanitizeLimit(query.limit ?? CommoditiesService.DEFAULT_LIST_LIMIT))
      .map((item) => this.toDto(item));
  }

  async getById(id: number): Promise<CommodityDto> {
    const commodity = await this.commodityRepository.findOne({
      where: { id },
      relations: { group: true },
    });
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
      groupId: null,
    });

    const saved = await this.commodityRepository.save(commodity);
    return this.toDto(saved);
  }

  async update(id: number, dto: CreateCommodityDto): Promise<CommodityDto> {
    const commodity = await this.commodityRepository.findOne({
      where: { id },
      relations: { group: true },
    });
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

    if (commodity.groupId != null) {
      const duplicateInGroup = await this.commodityRepository.findOne({
        where: {
          groupId: commodity.groupId,
          name: normalizedName,
        },
      });
      if (duplicateInGroup && duplicateInGroup.id !== id) {
        throw new ConflictException(
          'Commodity already exists in this group',
        );
      }
    } else {
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
    const commodity = await this.commodityRepository.findOne({
      where: { id },
      relations: { group: true },
    });
    if (!commodity) {
      throw new NotFoundException('Commodity not found');
    }

    if (
      await this.usageChecker.isInUse({
        id: commodity.id,
        name: commodity.name,
        displayName: commodity.displayName,
        groupName: commodity.group?.name ?? null,
      })
    ) {
      throw new ConflictException(CommoditiesService.IN_USE_MESSAGE);
    }

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

  /** Shared with CommodityGroupsService for consistent cargo-type validation. */
  normalizeCargoTypePublic(value?: string): string {
    return this.normalizeCargoType(value);
  }

  toDto(item: Commodity): CommodityDto {
    return {
      id: item.id,
      serviceTypeId: item.serviceTypeId,
      groupId: item.groupId ?? item.group?.id ?? null,
      groupName: item.group?.name ?? null,
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
