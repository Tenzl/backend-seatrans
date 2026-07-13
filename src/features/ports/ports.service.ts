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
import {
  ListPortsQueryDto,
  type PortSearchIn,
} from './dto/list-ports-query.dto';
import { buildPaginatedResponse } from '../../shared/dto/pagination.dto';
import { API_MAX_PAGE_SIZE } from '../../shared/dto/list-query.dto';
import {
  normalizeProvinceAreaCode,
  PROVINCE_AREA_LABELS,
} from '../provinces/province-area';

interface PortListParams {
  activeOnly?: boolean;
  provinceId?: number;
  area?: number;
  q?: string;
  searchIn?: PortSearchIn;
}

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
    const params: PortListParams = {
      activeOnly: query.active,
      provinceId: query.provinceId,
      area: query.area,
      q: query.q,
      searchIn: query.searchIn,
    };
    const totalElements = await this.getPortListCount(params);
    // Let Postgres rank/slice first, then fetch only the entities for that page.
    const ids = await this.getOrderedPortIds(params, size, page * size);
    const content = await this.getPortsByOrderedIds(ids);
    return buildPaginatedResponse(content, totalElements, page, size);
  }

  async listPorts(filters: ListPortsFilters = {}): Promise<PortDto[]> {
    const limit = this.sanitizeLimit(
      filters.limit ?? PortsService.DEFAULT_LIST_LIMIT,
    );
    const ids = await this.getOrderedPortIds(
      {
        activeOnly: filters.activeOnly,
        provinceId: filters.provinceId,
        area: filters.area,
      },
      limit,
    );
    return this.getPortsByOrderedIds(ids);
  }

  async getAllPorts(
    limit = PortsService.DEFAULT_LIST_LIMIT,
  ): Promise<PortDto[]> {
    return this.listPorts({ limit });
  }

  async getActivePorts(
    limit = PortsService.DEFAULT_LIST_LIMIT,
  ): Promise<PortDto[]> {
    return this.listPorts({ activeOnly: true, limit });
  }

  async listPortOptions(params: {
    q?: string;
    ids?: number[];
    limit?: number;
  }): Promise<PortOptionDto[]> {
    const limit = this.sanitizeOptionsLimit(
      params.limit ?? PortsService.DEFAULT_OPTIONS_LIMIT,
    );
    const ids = (params.ids ?? []).filter(
      (id) => Number.isInteger(id) && id > 0,
    );

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

    return ports
      .slice(0, this.sanitizeLimit(limit))
      .map((port) => this.toDto(port));
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

  async searchPortsByProvince(
    provinceId: number,
    query?: string,
  ): Promise<PortDto[]> {
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

    const duplicate = await this.findDuplicatePort(
      normalizedName,
      province?.id ?? null,
    );
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

    const province =
      dto.provinceId === undefined
        ? port.province
        : await this.resolveProvince(dto.provinceId);

    const duplicate = await this.findDuplicatePort(
      normalizedName,
      province?.id ?? null,
    );
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
    // Legacy rows may still carry province_id = 0 until the DB cleanup runs.
    const provinceId = this.normalizeProvinceId(port.province?.id);
    const provinceName = provinceId
      ? (port.province?.displayName ?? port.province?.name ?? null)
      : null;
    const provinceArea = provinceId ? (port.province?.area ?? null) : null;

    return {
      id: port.id,
      name: port.name,
      portOfCall: port.portOfCall,
      provinceId,
      provinceName,
      provinceArea,
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

  private normalizePortOfCall(
    providedPortOfCall: string | undefined,
    normalizedName: string,
  ): string {
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

  private async getPortListCount(params: PortListParams): Promise<number> {
    const { whereSql, values } = this.buildPortListWhereClause(params);
    const sql = `
      SELECT COUNT(*)::int AS total
      FROM ports port
      LEFT JOIN provinces province ON province.id = port.province_id
      ${whereSql}
    `;
    const rows = await this.portRepository.query<
      Array<{
        total?: number | string | null;
      }>
    >(sql, values);
    return Number(rows[0]?.total ?? 0);
  }

  private async getOrderedPortIds(
    params: PortListParams,
    limit: number,
    offset = 0,
  ): Promise<number[]> {
    const { whereSql, values } = this.buildPortListWhereClause(params);
    const limitParam = values.length + 1;
    const offsetParam = values.length + 2;
    const sql = `
      SELECT port.id
      FROM ports port
      LEFT JOIN provinces province ON province.id = port.province_id
      ${whereSql}
      ORDER BY
        CASE
          -- province_id = 0 is a legacy sentinel, so only positive ids count as real province links.
          WHEN COALESCE(port.province_id, 0) > 0
            AND province.area IN (1, 2, 3)
          THEN 0
          ELSE 1
        END ASC,
        CASE
          WHEN UPPER(COALESCE(port.country_code, '')) = 'VN' THEN 0
          ELSE 1
        END ASC,
        port.name ASC
      LIMIT $${limitParam}
      OFFSET $${offsetParam}
    `;

    const rows = await this.portRepository.query<
      Array<{ id: number | string }>
    >(sql, [...values, limit, offset]);
    return rows
      .map((row) => Number(row.id))
      .filter((id: number) => Number.isInteger(id) && id > 0);
  }

  private buildPortListWhereClause(params: PortListParams): {
    whereSql: string;
    values: Array<string | number | boolean | number[]>;
  } {
    const conditions: string[] = [];
    const values: Array<string | number | boolean | number[]> = [];

    if (params.activeOnly) {
      values.push(true);
      conditions.push(`port.is_active = $${values.length}`);
    }

    const provinceId = this.normalizeProvinceId(params.provinceId);
    if (provinceId != null) {
      values.push(provinceId);
      conditions.push(`province.id = $${values.length}`);
    }

    if (params.area) {
      values.push(params.area);
      conditions.push(`province.id IS NOT NULL`);
      conditions.push(`province.area = $${values.length}`);
    }

    const search = params.q?.trim().toLowerCase();
    if (search) {
      const term = `%${search}%`;
      const searchIn = params.searchIn ?? 'name';

      if (searchIn === 'area') {
        const areaCode = normalizeProvinceAreaCode(search);
        if (areaCode != null) {
          values.push(areaCode);
          conditions.push(`province.area = $${values.length}`);
        } else {
          const matchedCodes = Object.entries(PROVINCE_AREA_LABELS)
            .filter(([, label]) => label.includes(search.toUpperCase()))
            .map(([code]) => Number(code));
          if (matchedCodes.length === 0) {
            conditions.push('1 = 0');
          } else {
            values.push(matchedCodes);
            conditions.push(`province.area = ANY($${values.length})`);
          }
        }
      } else if (searchIn === 'provinceName') {
        values.push(term, term);
        conditions.push(
          `(LOWER(COALESCE(province.name, '')) LIKE $${values.length - 1} OR LOWER(COALESCE(province.display_name, '')) LIKE $${values.length})`,
        );
      } else {
        const columnBySearchIn: Record<
          Exclude<PortSearchIn, 'area' | 'provinceName'>,
          string
        > = {
          name: 'port.name',
          portOfCall: 'port.port_of_call',
          code: 'port.code',
          zoneCode: 'port.zone_code',
          countryCode: 'port.country_code',
        };
        values.push(term);
        conditions.push(
          `LOWER(COALESCE(${columnBySearchIn[searchIn]}, '')) LIKE $${values.length}`,
        );
      }
    }

    return {
      whereSql:
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      values,
    };
  }

  private async getPortsByOrderedIds(ids: number[]): Promise<PortDto[]> {
    if (ids.length === 0) {
      return [];
    }

    const ports = await this.portRepository
      .createQueryBuilder('port')
      .leftJoinAndSelect('port.province', 'province')
      .where('port.id IN (:...ids)', { ids })
      .getMany();

    const portMap = new Map(ports.map((port) => [port.id, port]));
    return ids
      .map((id) => portMap.get(id))
      .filter((port): port is Port => Boolean(port))
      .map((port) => this.toDto(port));
  }

  private async resolveProvince(provinceId?: number): Promise<Province | null> {
    const normalizedProvinceId = this.normalizeProvinceId(provinceId);
    if (normalizedProvinceId === null) {
      return null;
    }

    const province = await this.provinceRepository.findOne({
      where: { id: normalizedProvinceId },
    });
    if (!province) {
      throw new BadRequestException('Province not found');
    }

    return province;
  }

  private normalizeProvinceId(provinceId?: number | null): number | null {
    // Treat non-positive ids as "no province" so code and data use one consistent null semantic.
    if (!Number.isInteger(provinceId) || (provinceId ?? 0) <= 0) {
      return null;
    }
    return provinceId as number;
  }

  private async findDuplicatePort(
    name: string,
    provinceId: number | null,
  ): Promise<Port | null> {
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
