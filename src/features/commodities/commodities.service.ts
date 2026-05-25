import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Commodity } from './entities/commodity.entity';
import { CommodityDto } from './dto/commodity.dto';
import { CreateCommodityDto } from './dto/create-commodity.dto';

@Injectable()
export class CommoditiesService {
  private static readonly DEFAULT_LIST_LIMIT = 100;

  constructor(
    @InjectRepository(Commodity)
    private readonly commodityRepository: Repository<Commodity>,
  ) {}

  async getActive(limit = CommoditiesService.DEFAULT_LIST_LIMIT): Promise<CommodityDto[]> {
    const commodities = await this.commodityRepository.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });

    return commodities.slice(0, this.sanitizeLimit(limit)).map((item) => this.toDto(item));
  }

  async getByServiceType(
    serviceTypeId: number,
    limit = CommoditiesService.DEFAULT_LIST_LIMIT,
  ): Promise<CommodityDto[]> {
    const commodities = await this.commodityRepository.find({
      where: { serviceTypeId, isActive: true },
      order: { name: 'ASC' },
    });

    return commodities.slice(0, this.sanitizeLimit(limit)).map((item) => this.toDto(item));
  }

  async search(query?: string): Promise<CommodityDto[]> {
    const normalizedQuery = query?.trim();
    if (!normalizedQuery) {
      return this.getActive();
    }

    const commodities = await this.commodityRepository
      .createQueryBuilder('commodity')
      .where('commodity.is_active = :active', { active: true })
      .andWhere(
        '(LOWER(commodity.name) LIKE :query OR LOWER(commodity.display_name) LIKE :query)',
        { query: `%${normalizedQuery.toLowerCase()}%` },
      )
      .orderBy('commodity.name', 'ASC')
      .getMany();

    // Search query returns full matching dataset by migration rule.
    return commodities.map((item) => this.toDto(item));
  }

  async searchByServiceType(serviceTypeId: number, query?: string): Promise<CommodityDto[]> {
    const normalizedQuery = query?.trim();
    if (!normalizedQuery) {
      return this.getByServiceType(serviceTypeId);
    }

    const commodities = await this.commodityRepository
      .createQueryBuilder('commodity')
      .where('commodity.is_active = :active', { active: true })
      .andWhere('commodity.service_type_id = :serviceTypeId', { serviceTypeId })
      .andWhere(
        '(LOWER(commodity.name) LIKE :query OR LOWER(commodity.display_name) LIKE :query)',
        { query: `%${normalizedQuery.toLowerCase()}%` },
      )
      .orderBy('commodity.name', 'ASC')
      .getMany();

    // Search query returns full matching dataset by migration rule.
    return commodities.map((item) => this.toDto(item));
  }

  async getAllAdmin(limit = CommoditiesService.DEFAULT_LIST_LIMIT): Promise<CommodityDto[]> {
    const commodities = await this.commodityRepository.find({
      order: { name: 'ASC' },
    });

    return commodities.slice(0, this.sanitizeLimit(limit)).map((item) => this.toDto(item));
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
      throw new BadRequestException('Commodity name and displayName are required');
    }

    const duplicate = await this.commodityRepository.findOne({
      where: { serviceTypeId: dto.serviceTypeId, name: normalizedName },
    });

    if (duplicate) {
      throw new ConflictException('Commodity already exists in this service type');
    }

    const commodity = this.commodityRepository.create({
      serviceTypeId: dto.serviceTypeId,
      name: normalizedName,
      displayName: normalizedDisplayName,
      description: dto.description?.trim() || null,
      requiredImageCount: dto.requiredImageCount ?? 18,
      cargoType: this.normalizeCargoType(dto.cargoType),
      isActive: true,
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
      throw new BadRequestException('Commodity name and displayName are required');
    }

    const duplicate = await this.commodityRepository.findOne({
      where: { serviceTypeId: dto.serviceTypeId, name: normalizedName },
    });

    if (duplicate && duplicate.id !== id) {
      throw new ConflictException('Commodity already exists in this service type');
    }

    commodity.serviceTypeId = dto.serviceTypeId;
    commodity.name = normalizedName;
    commodity.displayName = normalizedDisplayName;
    commodity.description = dto.description?.trim() || null;
    commodity.requiredImageCount = dto.requiredImageCount ?? commodity.requiredImageCount;
    commodity.cargoType = this.normalizeCargoType(dto.cargoType ?? commodity.cargoType);

    const updated = await this.commodityRepository.save(commodity);
    return this.toDto(updated);
  }

  async delete(id: number): Promise<void> {
    const commodity = await this.commodityRepository.findOne({ where: { id } });
    if (!commodity) {
      throw new NotFoundException('Commodity not found');
    }
    commodity.isActive = false;
    await this.commodityRepository.save(commodity);
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
      isActive: item.isActive,
    };
  }

  private normalizeCargoType(value?: string): string {
    const normalized = value?.trim();
    if (!normalized) {
      return 'IN_BULK';
    }
    return normalized.toUpperCase();
  }

  private sanitizeLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) {
      return CommoditiesService.DEFAULT_LIST_LIMIT;
    }
    return Math.min(limit, CommoditiesService.DEFAULT_LIST_LIMIT);
  }
}
