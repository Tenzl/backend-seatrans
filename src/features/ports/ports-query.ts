import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { buildPaginatedResponse } from '../../shared/dto/pagination.dto';
import { API_MAX_PAGE_SIZE } from '../../shared/dto/list-query.dto';
import { normalizeProvinceAreaCode } from '../provinces/province-area';
import type { ListPortsFilters } from './dto/list-ports-filters';
import {
  type ListPortsQueryDto,
  type PortSearchIn,
} from './dto/list-ports-query.dto';
import type { PortOptionDto } from './dto/port-option.dto';
import type { PortDto } from './dto/port.dto';
import type { Port } from './entities/port.entity';
import { normalizeProvinceId, toPortDto } from './port-normalization';

interface PortListParams {
  activeOnly?: boolean;
  provinceId?: number;
  area?: number;
  q?: string;
  searchIn?: PortSearchIn;
}

export const DEFAULT_PORT_LIST_LIMIT = 2000;

export class PortsQuery {
  private static readonly MAX_LIST_LIMIT = 5000;
  private static readonly DEFAULT_OPTIONS_LIMIT = 30;
  private static readonly MAX_OPTIONS_LIMIT = 50;

  constructor(private readonly portRepository: Repository<Port>) {}

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
    const ids = await this.getOrderedPortIds(params, size, page * size);
    const content = await this.getPortsByOrderedIds(ids);
    return buildPaginatedResponse(content, totalElements, page, size);
  }

  async listPorts(filters: ListPortsFilters = {}): Promise<PortDto[]> {
    const limit = this.sanitizeLimit(filters.limit ?? DEFAULT_PORT_LIST_LIMIT);
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

  async getAllPorts(limit = DEFAULT_PORT_LIST_LIMIT): Promise<PortDto[]> {
    return this.listPorts({ limit });
  }

  async getActivePorts(limit = DEFAULT_PORT_LIST_LIMIT): Promise<PortDto[]> {
    return this.listPorts({ activeOnly: true, limit });
  }

  async listPortOptions(params: {
    q?: string;
    ids?: number[];
    limit?: number;
  }): Promise<PortOptionDto[]> {
    const limit = this.sanitizeOptionsLimit(
      params.limit ?? PortsQuery.DEFAULT_OPTIONS_LIMIT,
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
      code: port.code ?? null,
      countryCode: port.countryCode ?? null,
    }));
  }

  async getPortsByProvince(
    provinceId: number,
    limit = DEFAULT_PORT_LIST_LIMIT,
  ): Promise<PortDto[]> {
    const ports = await this.portRepository.find({
      where: { province: { id: provinceId }, isActive: true },
      relations: { province: true },
      order: { name: 'ASC' },
    });

    return ports
      .slice(0, this.sanitizeLimit(limit))
      .map((port) => toPortDto(port));
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
    return ports.map((port) => toPortDto(port));
  }

  async getPortById(id: number): Promise<PortDto> {
    const port = await this.portRepository.findOne({
      where: { id },
      relations: { province: true },
    });

    if (!port) {
      throw new NotFoundException('Port not found');
    }

    return toPortDto(port);
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

    const provinceId = normalizeProvinceId(params.provinceId);
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
          conditions.push('1 = 0');
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
      .map((port) => toPortDto(port));
  }

  private sanitizePageSize(size: number): number {
    if (!Number.isFinite(size) || size <= 0) {
      return API_MAX_PAGE_SIZE;
    }
    return Math.min(size, API_MAX_PAGE_SIZE);
  }

  private sanitizeLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) {
      return DEFAULT_PORT_LIST_LIMIT;
    }
    return Math.min(limit, PortsQuery.MAX_LIST_LIMIT);
  }

  private sanitizeOptionsLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) {
      return PortsQuery.DEFAULT_OPTIONS_LIMIT;
    }
    return Math.min(limit, PortsQuery.MAX_OPTIONS_LIMIT);
  }
}
