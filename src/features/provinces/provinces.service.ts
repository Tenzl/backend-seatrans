import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Province } from './entities/province.entity';
import { ProvinceDto } from './dto/province.dto';
import { CreateProvinceDto } from './dto/create-province.dto';
import { normalizeProvinceAreaCode } from './province-area';
import { ShortTtlCacheService } from '../../shared/redis/short-ttl-cache.service';

/** Shared with PortsService — active list filters out provinces with zero ports. */
export const PUBLIC_PROVINCES_CACHE_PREFIX = 'public:provinces:';

@Injectable()
export class ProvincesService {
  private static readonly DEFAULT_LIST_LIMIT = 100;

  constructor(
    @InjectRepository(Province)
    private readonly provinceRepository: Repository<Province>,
    private readonly cache: ShortTtlCacheService,
  ) {}

  async getAllProvinces(
    limit = ProvincesService.DEFAULT_LIST_LIMIT,
  ): Promise<ProvinceDto[]> {
    const provinces = await this.provinceRepository.find({
      relations: { ports: true },
      order: { name: 'ASC' },
    });

    return provinces
      .slice(0, this.sanitizeLimit(limit))
      .map((province) => this.toDto(province));
  }

  async getActiveProvinces(
    limit = ProvincesService.DEFAULT_LIST_LIMIT,
  ): Promise<ProvinceDto[]> {
    const safeLimit = this.sanitizeLimit(limit);
    const cacheKey = `${PUBLIC_PROVINCES_CACHE_PREFIX}active:${safeLimit}`;
    if (this.cache.isEnabled()) {
      const cached = await this.cache.getJson<ProvinceDto[]>(cacheKey);
      if (cached) return cached;
    }

    const provinces = await this.provinceRepository.find({
      where: { isActive: true },
      relations: { ports: true },
      order: { name: 'ASC' },
    });

    const result = provinces
      .filter((province) => (province.ports ?? []).length > 0)
      .slice(0, safeLimit)
      .map((province) => this.toDto(province));

    await this.cache.setJson(cacheKey, result);
    return result;
  }

  async searchProvinces(query?: string): Promise<ProvinceDto[]> {
    const normalizedQuery = query?.trim();
    if (!normalizedQuery) {
      return this.getActiveProvinces();
    }

    const provinces = await this.provinceRepository
      .createQueryBuilder('province')
      .leftJoinAndSelect('province.ports', 'port')
      .where('province.is_active = :active', { active: true })
      .andWhere('LOWER(province.name) LIKE :query', {
        query: `%${normalizedQuery.toLowerCase()}%`,
      })
      .orderBy('province.name', 'ASC')
      .getMany();

    return provinces.map((province) => this.toDto(province));
  }

  async getProvinceById(id: number): Promise<ProvinceDto> {
    const province = await this.provinceRepository.findOne({
      where: { id },
      relations: { ports: true },
    });

    if (!province) {
      throw new NotFoundException('Province not found');
    }

    return this.toDto(province);
  }

  async createProvince(dto: CreateProvinceDto): Promise<ProvinceDto> {
    const name = dto.name?.trim();
    if (!name) {
      throw new BadRequestException('Province name is required');
    }

    const existing = await this.provinceRepository.findOne({ where: { name } });
    if (existing) {
      throw new ConflictException('Province already exists');
    }

    const province = this.provinceRepository.create({
      name,
      displayName: this.resolveDisplayName(name, dto.displayName),
      code: dto.code ?? null,
      area: this.normalizeAreaCode(dto.area),
      isActive: true,
    });

    const savedProvince = await this.provinceRepository.save(province);
    await this.invalidatePublicCache();
    return this.toDto(savedProvince);
  }

  async updateProvince(
    id: number,
    dto: CreateProvinceDto,
  ): Promise<ProvinceDto> {
    const province = await this.provinceRepository.findOne({
      where: { id },
      relations: { ports: true },
    });

    if (!province) {
      throw new NotFoundException('Province not found');
    }

    const name = dto.name?.trim();
    if (!name) {
      throw new BadRequestException('Province name is required');
    }

    const duplicate = await this.provinceRepository.findOne({
      where: { name },
    });
    if (duplicate && duplicate.id !== id) {
      throw new ConflictException('Province name already exists');
    }

    province.name = name;
    province.displayName = this.resolveDisplayName(name, dto.displayName);
    province.code = dto.code ?? null;
    province.area = this.normalizeAreaCode(dto.area);

    const updatedProvince = await this.provinceRepository.save(province);
    await this.invalidatePublicCache();
    return this.toDto(updatedProvince);
  }

  async deleteProvince(id: number): Promise<void> {
    const province = await this.provinceRepository.findOne({ where: { id } });
    if (!province) {
      throw new NotFoundException('Province not found');
    }
    await this.provinceRepository.delete(id);
    await this.invalidatePublicCache();
  }

  private async invalidatePublicCache(): Promise<void> {
    await this.cache.deleteByPrefix(PUBLIC_PROVINCES_CACHE_PREFIX);
  }

  private toDto(province: Province): ProvinceDto {
    const ports = (province.ports ?? []).map((port) => port.name);

    return {
      id: province.id,
      name: province.name,
      displayName: province.displayName ?? null,
      code: province.code ?? null,
      area: province.area ?? null,
      portCount: ports.length,
      ports,
      isActive: province.isActive,
    };
  }

  private resolveDisplayName(name: string, displayName?: string): string {
    const normalizedDisplayName = displayName?.trim();
    if (normalizedDisplayName) {
      return normalizedDisplayName;
    }
    return this.toTitleCase(name);
  }

  private normalizeAreaCode(value?: number | null): number | null {
    return normalizeProvinceAreaCode(value) ?? null;
  }

  private toTitleCase(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' ');
  }

  private sanitizeLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) {
      return ProvincesService.DEFAULT_LIST_LIMIT;
    }
    return Math.min(limit, ProvincesService.DEFAULT_LIST_LIMIT);
  }
}
