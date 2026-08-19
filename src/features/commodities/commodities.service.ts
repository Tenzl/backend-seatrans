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
      .slice(
        0,
        this.sanitizeLimit(
          query.limit ?? CommoditiesService.DEFAULT_LIST_LIMIT,
        ),
      )
      .map((item) => this.toDto(item));
  }

  async getById(id: number): Promise<CommodityDto> {
    const commodity = await this.commodityRepository.findOne({
      where: { id },
    });
    if (!commodity) {
      throw new NotFoundException('Commodity not found');
    }
    return this.toDto(commodity);
  }

  async create(dto: CreateCommodityDto): Promise<CommodityDto> {
    const normalizedDisplayName = this.normalizeDisplayName(dto.displayName);
    if (!normalizedDisplayName) {
      throw new BadRequestException('Commodity displayName is required');
    }
    const normalizedName = dto.name?.trim()
      ? this.normalizeName(dto.name)
      : this.generateName(normalizedDisplayName);
    if (!normalizedName) {
      throw new BadRequestException(
        'Commodity name cannot be generated from displayName',
      );
    }

    await this.assertUniqueName(dto.serviceTypeId, normalizedName);

    const commodity = this.commodityRepository.create({
      serviceTypeId: dto.serviceTypeId,
      name: normalizedName,
      displayName: normalizedDisplayName,
      description: dto.description?.trim() || null,
    });

    const saved = await this.saveOrConflict(commodity);
    return this.toDto(saved);
  }

  async update(id: number, dto: CreateCommodityDto): Promise<CommodityDto> {
    const commodity = await this.commodityRepository.findOne({
      where: { id },
    });
    if (!commodity) {
      throw new NotFoundException('Commodity not found');
    }

    const normalizedDisplayName = this.normalizeDisplayName(dto.displayName);
    if (!normalizedDisplayName) {
      throw new BadRequestException('Commodity displayName is required');
    }
    const normalizedName = dto.name?.trim()
      ? this.normalizeName(dto.name)
      : commodity.name;

    await this.assertUniqueName(dto.serviceTypeId, normalizedName, id);

    commodity.serviceTypeId = dto.serviceTypeId;
    commodity.name = normalizedName;
    commodity.displayName = normalizedDisplayName;
    commodity.description = dto.description?.trim() || null;

    const updated = await this.saveOrConflict(commodity);
    return this.toDto(updated);
  }

  async delete(id: number): Promise<void> {
    const commodity = await this.commodityRepository.findOne({
      where: { id },
    });
    if (!commodity) {
      throw new NotFoundException('Commodity not found');
    }

    if (
      await this.usageChecker.isInUse({
        id: commodity.id,
        name: commodity.name,
        displayName: commodity.displayName,
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

  toDto(item: Commodity): CommodityDto {
    return {
      id: item.id,
      serviceTypeId: item.serviceTypeId,
      name: item.name,
      displayName: item.displayName,
      description: item.description,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private normalizeName(value: string): string {
    return value?.trim().replace(/\s+/g, ' ') ?? '';
  }

  private normalizeDisplayName(value: string): string {
    return value?.trim().replace(/\s+/g, ' ') ?? '';
  }

  private generateName(displayName: string): string {
    return displayName
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, (value) => (value === 'đ' ? 'd' : 'D'))
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 100)
      .replace(/_+$/g, '');
  }

  private normalizedNameKey(value: string): string {
    return this.normalizeName(value)
      .replace(/[\s_/-]+/g, ' ')
      .toLocaleLowerCase('en-US');
  }

  private async assertUniqueName(
    serviceTypeId: number,
    name: string,
    excludeId?: number,
  ): Promise<void> {
    const rows = await this.commodityRepository.find({
      where: { serviceTypeId },
    });
    const key = this.normalizedNameKey(name);
    if (
      rows.some(
        (row) =>
          row.id !== excludeId && this.normalizedNameKey(row.name) === key,
      )
    ) {
      throw new ConflictException(
        'Commodity name already exists for this Service',
      );
    }
  }

  private async saveOrConflict(commodity: Commodity): Promise<Commodity> {
    try {
      return await this.commodityRepository.save(commodity);
    } catch (error) {
      const databaseCode = (error as { driverError?: { code?: string } } | null)
        ?.driverError?.code;
      if (databaseCode === '23505') {
        throw new ConflictException(
          'Commodity name already exists for this Service',
        );
      }
      throw error;
    }
  }

  private sanitizeLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) {
      return CommoditiesService.DEFAULT_LIST_LIMIT;
    }
    return Math.min(limit, CommoditiesService.DEFAULT_LIST_LIMIT);
  }
}
