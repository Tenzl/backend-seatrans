import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Port } from './entities/port.entity';
import { Province } from '../provinces/entities/province.entity';
import { PortDto } from './dto/port.dto';
import { PortOptionDto } from './dto/port-option.dto';
import { CreatePortDto } from './dto/create-port.dto';
import type { ListPortsFilters } from './dto/list-ports-filters';
import { ListPortsQueryDto, type PortSearchIn } from './dto/list-ports-query.dto';
import { buildPaginatedResponse } from '../../shared/dto/pagination.dto';
import { API_MAX_PAGE_SIZE } from '../../shared/dto/list-query.dto';
import type { SelectQueryBuilder } from 'typeorm';

@Injectable()
export class PortsService {
  private static readonly DEFAULT_LIST_LIMIT = 2000;
  private static readonly MAX_LIST_LIMIT = 5000;
  private static readonly DEFAULT_OPTIONS_LIMIT = 30;
  private static readonly MAX_OPTIONS_LIMIT = 50;

  constructor(
    @InjectRepository(Port)
    private readonly portRepository: Repository<Port>,
    @InjectRepository(Province)
    private readonly provinceRepository: Repository<Province>,
  ) {}

  async listPortsPage(query: ListPortsQueryDto) {
    const page = Math.max(0, Number(query.page ?? 0));
    const size = this.sanitizePageSize(Number(query.size ?? API_MAX_PAGE_SIZE));

    const qb = this.portRepository
      .createQueryBuilder('port')
      .leftJoinAndSelect('port.province', 'province')
      .orderBy('port.name', 'ASC');

    if (query.active) {
      qb.andWhere('port.is_active = :active', { active: true });
    }

    if (query.provinceId != null) {
      qb.andWhere('province.id = :provinceId', { provinceId: query.provinceId });
    }

    if (query.area) {
      qb
        .andWhere('province.id IS NOT NULL')
        .andWhere('UPPER(province.area) = :area', { area: query.area });
    }

    const search = query.q?.trim();
    if (search) {
      this.applyPortSearch(qb, search, query.searchIn ?? 'name');
    }

    qb.skip(page * size).take(size);

    const [ports, totalElements] = await qb.getManyAndCount();
    const content = ports.map((port) => this.toDto(port));
    return buildPaginatedResponse(content, totalElements, page, size);
  }

  async listPorts(filters: ListPortsFilters = {}): Promise<PortDto[]> {
    const queryBuilder = this.portRepository
      .createQueryBuilder('port')
      .leftJoinAndSelect('port.province', 'province')
      .orderBy('port.name', 'ASC');

    if (filters.activeOnly) {
      queryBuilder.andWhere('port.is_active = :active', { active: true });
    }

    if (filters.provinceId != null) {
      queryBuilder.andWhere('province.id = :provinceId', {
        provinceId: filters.provinceId,
      });
    }

    if (filters.area) {
      queryBuilder
        .andWhere('province.id IS NOT NULL')
        .andWhere('UPPER(province.area) = :area', { area: filters.area });
    }

    const limit = this.sanitizeLimit(filters.limit ?? PortsService.DEFAULT_LIST_LIMIT);
    queryBuilder.take(limit);

    const ports = await queryBuilder.getMany();
    return ports.map((port) => this.toDto(port));
  }

  async getAllPorts(limit = PortsService.DEFAULT_LIST_LIMIT): Promise<PortDto[]> {
    return this.listPorts({ limit });
  }

  async getActivePorts(limit = PortsService.DEFAULT_LIST_LIMIT): Promise<PortDto[]> {
    return this.listPorts({ activeOnly: true, limit });
  }

  async listPortOptions(params: {
    q?: string;
    ids?: number[];
    limit?: number;
  }): Promise<PortOptionDto[]> {
    const limit = this.sanitizeOptionsLimit(params.limit ?? PortsService.DEFAULT_OPTIONS_LIMIT);
    const ids = (params.ids ?? []).filter((id) => Number.isInteger(id) && id > 0);

    const qb = this.portRepository
      .createQueryBuilder('port')
      .leftJoinAndSelect('port.province', 'province')
      .where('port.is_active = :active', { active: true })
      .orderBy('port.name', 'ASC')
      .take(limit);

    if (ids.length > 0) {
      qb.andWhere('port.id IN (:...ids)', { ids });
    } else {
      const query = params.q?.trim();
      if (query) {
        qb.andWhere('LOWER(port.name) LIKE :q', {
          q: `%${query.toLowerCase()}%`,
        });
      }
    }

    const rows = await qb.getMany();
    return rows.map((port) => ({
      id: port.id,
      name: port.name,
      provinceName: port.province?.name ?? null,
    }));
  }

  async getPortsByProvince(
    provinceId: number,
    limit = PortsService.DEFAULT_LIST_LIMIT,
  ): Promise<PortDto[]> {
    const ports = await this.portRepository.find({
      where: { province: { id: provinceId }, isActive: true },
      relations: { province: true },
      order: { name: 'ASC' },
    });

    return ports.slice(0, this.sanitizeLimit(limit)).map((port) => this.toDto(port));
  }

  async searchPorts(query?: string): Promise<PortDto[]> {
    const normalizedQuery = query?.trim();
    if (!normalizedQuery) {
      return this.getActivePorts();
    }

    const page = await this.listPortsPage({
      q: normalizedQuery,
      searchIn: 'name',
      active: true,
      page: 0,
      size: API_MAX_PAGE_SIZE,
    });
    return page.content;
  }

  async searchPortsByProvince(provinceId: number, query?: string): Promise<PortDto[]> {
    const normalizedQuery = query?.trim();

    const queryBuilder = this.portRepository
      .createQueryBuilder('port')
      .leftJoinAndSelect('port.province', 'province')
      .where('port.is_active = :active', { active: true })
      .andWhere('province.id = :provinceId', { provinceId })
      .orderBy('port.name', 'ASC');

    if (normalizedQuery) {
      queryBuilder.andWhere('LOWER(port.name) LIKE :query', {
        query: `%${normalizedQuery.toLowerCase()}%`,
      });
    }

    const ports = await queryBuilder.getMany();
    return ports.map((port) => this.toDto(port));
  }

  async getPortById(id: number): Promise<PortDto> {
    const port = await this.portRepository.findOne({
      where: { id },
      relations: { province: true },
    });

    if (!port) {
      throw new NotFoundException('Port not found');
    }

    return this.toDto(port);
  }

  async createPort(dto: CreatePortDto): Promise<PortDto> {
    const normalizedName = this.normalizePortName(dto.name);
    if (!normalizedName) {
      throw new BadRequestException('Port name is required');
    }

    const province = await this.resolveProvince(dto.provinceId);

    const duplicate = await this.findDuplicatePort(normalizedName, province?.id ?? null);
    if (duplicate) {
      throw new ConflictException('Port already exists in this province scope');
    }

    const port = this.portRepository.create({
      name: normalizedName,
      portOfCall: this.normalizePortOfCall(dto.portOfCall, normalizedName),
      province: province ?? null,
      zoneCode: dto.zoneCode?.trim() || null,
      countryCode: dto.countryCode?.trim().toUpperCase() || null,
      code: dto.code?.trim() || null,
      longitude: dto.longitude ?? null,
      latitude: dto.latitude ?? null,
      isActive: dto.isActive ?? true,
      hasInfo: dto.hasInfo ?? 0,
    });

    const savedPort = await this.portRepository.save(port);
    return this.toDto(savedPort);
  }

  async updatePort(id: number, dto: CreatePortDto): Promise<PortDto> {
    const port = await this.portRepository.findOne({
      where: { id },
      relations: { province: true },
    });

    if (!port) {
      throw new NotFoundException('Port not found');
    }

    const normalizedName = this.normalizePortName(dto.name);
    if (!normalizedName) {
      throw new BadRequestException('Port name is required');
    }

    const province = dto.provinceId === undefined
      ? port.province
      : await this.resolveProvince(dto.provinceId);

    const duplicate = await this.findDuplicatePort(normalizedName, province?.id ?? null);
    if (duplicate && duplicate.id !== id) {
      throw new ConflictException('Port already exists in this province scope');
    }

    port.name = normalizedName;
    port.portOfCall = this.normalizePortOfCall(dto.portOfCall, normalizedName);
    port.province = province ?? null;

    if (dto.zoneCode !== undefined) {
      port.zoneCode = dto.zoneCode?.trim() || null;
    }
    if (dto.countryCode !== undefined) {
      port.countryCode = dto.countryCode?.trim().toUpperCase() || null;
    }
    if (dto.code !== undefined) {
      port.code = dto.code?.trim() || null;
    }
    if (dto.longitude !== undefined) {
      port.longitude = dto.longitude;
    }
    if (dto.latitude !== undefined) {
      port.latitude = dto.latitude;
    }
    if (dto.isActive !== undefined) {
      port.isActive = dto.isActive;
    }
    if (dto.hasInfo !== undefined) {
      port.hasInfo = dto.hasInfo;
    }

    const updatedPort = await this.portRepository.save(port);
    return this.toDto(updatedPort);
  }

  async updateHasInfo(id: number, hasInfo: number): Promise<PortDto> {
    const port = await this.portRepository.findOne({
      where: { id },
      relations: { province: true },
    });

    if (!port) {
      throw new NotFoundException('Port not found');
    }

    port.hasInfo = hasInfo;
    const updatedPort = await this.portRepository.save(port);
    return this.toDto(updatedPort);
  }

  async deletePort(id: number): Promise<void> {
    const existing = await this.portRepository.findOne({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Port not found');
    }
    await this.portRepository.delete(id);
  }

  private toDto(port: Port): PortDto {
    return {
      id: port.id,
      name: port.name,
      portOfCall: port.portOfCall,
      provinceId: port.province?.id ?? null,
      provinceName: port.province?.displayName ?? port.province?.name ?? null,
      zoneCode: port.zoneCode ?? null,
      countryCode: port.countryCode ?? null,
      code: port.code ?? null,
      longitude: port.longitude ?? null,
      latitude: port.latitude ?? null,
      isActive: port.isActive,
      hasInfo: port.hasInfo,
      createdAt: port.createdAt,
      updatedAt: port.updatedAt,
    };
  }

  private normalizePortName(value: string): string {
    return (value ?? '').trim().replace(/\s+/g, ' ');
  }

  private normalizePortOfCall(providedPortOfCall: string | undefined, normalizedName: string): string {
    const normalizedProvided = providedPortOfCall?.trim();
    if (normalizedProvided) {
      return normalizedProvided.replace(/\s+/g, ' ').toUpperCase();
    }

    const strippedName = normalizedName
      .toUpperCase()
      .replace(/(\s+(PORT|TERMINAL|ANCHORAGE))+$/i, '')
      .trim();

    return strippedName || normalizedName.toUpperCase();
  }

  private async resolveProvince(provinceId?: number): Promise<Province | null> {
    if (provinceId === undefined || provinceId === null) {
      return null;
    }

    const province = await this.provinceRepository.findOne({ where: { id: provinceId } });
    if (!province) {
      throw new BadRequestException('Province not found');
    }

    return province;
  }

  private async findDuplicatePort(name: string, provinceId: number | null): Promise<Port | null> {
    const queryBuilder = this.portRepository
      .createQueryBuilder('port')
      .leftJoinAndSelect('port.province', 'province')
      .where('LOWER(port.name) = :name', { name: name.toLowerCase() });

    if (provinceId === null) {
      queryBuilder.andWhere('port.province_id IS NULL');
    } else {
      queryBuilder.andWhere('port.province_id = :provinceId', { provinceId });
    }

    return queryBuilder.getOne();
  }

  private applyPortSearch(
    qb: SelectQueryBuilder<Port>,
    rawQuery: string,
    searchIn: PortSearchIn,
  ): void {
    const term = `%${rawQuery.toLowerCase()}%`;

    switch (searchIn) {
      case 'area':
        qb.andWhere('UPPER(province.area) LIKE :term', {
          term: `%${rawQuery.toUpperCase()}%`,
        });
        break;
      case 'provinceName':
        qb.andWhere(
          '(LOWER(province.name) LIKE :term OR LOWER(province.display_name) LIKE :term)',
          { term },
        );
        break;
      case 'portOfCall':
        qb.andWhere('LOWER(port.port_of_call) LIKE :term', { term });
        break;
      case 'code':
        qb.andWhere('LOWER(port.code) LIKE :term', { term });
        break;
      case 'zoneCode':
        qb.andWhere('LOWER(port.zone_code) LIKE :term', { term });
        break;
      case 'countryCode':
        qb.andWhere('LOWER(port.country_code) LIKE :term', { term });
        break;
      case 'name':
      default:
        qb.andWhere('LOWER(port.name) LIKE :term', { term });
        break;
    }
  }

  private sanitizePageSize(size: number): number {
    if (!Number.isFinite(size) || size <= 0) {
      return API_MAX_PAGE_SIZE;
    }
    return Math.min(size, API_MAX_PAGE_SIZE);
  }

  private sanitizeLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) {
      return PortsService.DEFAULT_LIST_LIMIT;
    }
    return Math.min(limit, PortsService.MAX_LIST_LIMIT);
  }

  private sanitizeOptionsLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) {
      return PortsService.DEFAULT_OPTIONS_LIMIT;
    }
    return Math.min(limit, PortsService.MAX_OPTIONS_LIMIT);
  }
}
