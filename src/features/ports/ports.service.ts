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
import { ListPortsQueryDto } from './dto/list-ports-query.dto';
import { normalizeProvinceAreaCode } from '../provinces/province-area';
import { EpdaParameterGroupMember } from '../epda-parameters/entities/epda-parameter-group-member.entity';
import { EpdaParameterSet } from '../epda-parameters/entities/epda-parameter-set.entity';
import {
  normalizePortName,
  normalizePortOfCall,
  normalizeProvinceId,
  toPortDto,
} from './port-normalization';
import { DEFAULT_PORT_LIST_LIMIT, PortsQuery } from './ports-query';

@Injectable()
export class PortsService {
  private readonly query: PortsQuery;

  constructor(
    @InjectRepository(Port)
    private readonly portRepository: Repository<Port>,
    @InjectRepository(Province)
    private readonly provinceRepository: Repository<Province>,
    @InjectRepository(EpdaParameterGroupMember)
    private readonly epdaGroupMemberRepository: Repository<EpdaParameterGroupMember>,
    @InjectRepository(EpdaParameterSet)
    private readonly epdaParameterSetRepository: Repository<EpdaParameterSet>,
  ) {
    this.query = new PortsQuery(portRepository);
  }

  async listPortsPage(query: ListPortsQueryDto) {
    return this.query.listPortsPage(query);
  }

  async listPorts(filters: ListPortsFilters = {}): Promise<PortDto[]> {
    return this.query.listPorts(filters);
  }

  async getAllPorts(limit = DEFAULT_PORT_LIST_LIMIT): Promise<PortDto[]> {
    return this.query.getAllPorts(limit);
  }

  async getActivePorts(limit = DEFAULT_PORT_LIST_LIMIT): Promise<PortDto[]> {
    return this.query.getActivePorts(limit);
  }

  async listPortOptions(params: {
    q?: string;
    ids?: number[];
    limit?: number;
  }): Promise<PortOptionDto[]> {
    return this.query.listPortOptions(params);
  }

  async getPortsByProvince(
    provinceId: number,
    limit = DEFAULT_PORT_LIST_LIMIT,
  ): Promise<PortDto[]> {
    return this.query.getPortsByProvince(provinceId, limit);
  }

  async searchPorts(query?: string): Promise<PortDto[]> {
    return this.query.searchPorts(query);
  }

  async searchPortsByProvince(
    provinceId: number,
    query?: string,
  ): Promise<PortDto[]> {
    return this.query.searchPortsByProvince(provinceId, query);
  }

  async getPortById(id: number): Promise<PortDto> {
    return this.query.getPortById(id);
  }

  async createPort(dto: CreatePortDto): Promise<PortDto> {
    const normalizedName = normalizePortName(dto.name);
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
      portOfCall: normalizePortOfCall(dto.portOfCall, normalizedName),
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
    return toPortDto(savedPort);
  }

  async updatePort(id: number, dto: CreatePortDto): Promise<PortDto> {
    const port = await this.portRepository.findOne({
      where: { id },
      relations: { province: true },
    });

    if (!port) {
      throw new NotFoundException('Port not found');
    }

    const normalizedName = normalizePortName(dto.name);
    if (!normalizedName) {
      throw new BadRequestException('Port name is required');
    }

    const province =
      dto.provinceId === undefined
        ? port.province
        : await this.resolveProvince(dto.provinceId);
    await this.assertAreaChangeAllowed(port, province);

    const duplicate = await this.findDuplicatePort(
      normalizedName,
      province?.id ?? null,
    );
    if (duplicate && duplicate.id !== id) {
      throw new ConflictException('Port already exists in this province scope');
    }

    port.name = normalizedName;
    port.portOfCall = normalizePortOfCall(dto.portOfCall, normalizedName);
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
    return toPortDto(updatedPort);
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
    return toPortDto(updatedPort);
  }

  async deletePort(id: number): Promise<void> {
    const existing = await this.portRepository.findOne({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Port not found');
    }
    await this.portRepository.delete(id);
  }

  private async resolveProvince(provinceId?: number): Promise<Province | null> {
    const normalizedProvinceId = normalizeProvinceId(provinceId);
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

  private async assertAreaChangeAllowed(
    port: Port,
    nextProvince: Province | null,
  ): Promise<void> {
    const currentArea = normalizeProvinceAreaCode(port.province?.area ?? null);
    const nextArea = normalizeProvinceAreaCode(nextProvince?.area ?? null);
    if (currentArea === nextArea) return;

    const membership = await this.epdaGroupMemberRepository.findOne({
      where: { portId: port.id },
      relations: { group: true },
    });
    // Keep checking JSONB during the membership-table compatibility window.
    const legacyGroup = membership
      ? null
      : await this.epdaParameterSetRepository
          .createQueryBuilder('parameterSet')
          .where(`parameterSet.scope = 'GROUP'`)
          .andWhere('parameterSet.memberPortIds @> :portIds::jsonb', {
            portIds: JSON.stringify([port.id]),
          })
          .getOne();
    if (!membership && !legacyGroup) return;

    throw new ConflictException(
      `Port belongs to EPDA group ${
        membership?.group?.name ??
        membership?.groupId ??
        legacyGroup?.name ??
        legacyGroup?.id
      }; remove it from the group before changing area`,
    );
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
}
