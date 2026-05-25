import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceType } from './entities/service-type.entity';
import { CreateServiceTypeDto } from './dto/create-service-type.dto';
import { ServiceTypeDto } from './dto/service-type.dto';
import { Commodity } from '../commodities/entities/commodity.entity';

@Injectable()
export class ServiceTypesService {
  private static readonly DEFAULT_LIMIT = 100;

  constructor(
    @InjectRepository(ServiceType)
    private readonly serviceTypeRepository: Repository<ServiceType>,
    @InjectRepository(Commodity)
    private readonly commodityRepository: Repository<Commodity>,
  ) {}

  async getAll(limit = ServiceTypesService.DEFAULT_LIMIT): Promise<ServiceTypeDto[]> {
    const rows = await this.serviceTypeRepository.find({ order: { name: 'ASC' } });
    return rows.slice(0, this.sanitizeLimit(limit)).map((item) => this.toDto(item));
  }

  async getActive(limit = ServiceTypesService.DEFAULT_LIMIT): Promise<ServiceTypeDto[]> {
    const rows = await this.serviceTypeRepository.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });
    return rows.slice(0, this.sanitizeLimit(limit)).map((item) => this.toDto(item));
  }

  async search(query?: string): Promise<ServiceTypeDto[]> {
    const normalizedQuery = query?.trim();
    if (!normalizedQuery) {
      return this.getActive();
    }

    const rows = await this.serviceTypeRepository
      .createQueryBuilder('serviceType')
      .where('serviceType.is_active = :active', { active: true })
      .andWhere('LOWER(serviceType.name) LIKE :q', { q: `%${normalizedQuery.toLowerCase()}%` })
      .orderBy('serviceType.name', 'ASC')
      .getMany();

    // Search requests can return full matching records.
    return rows.map((item) => this.toDto(item));
  }

  async getById(id: number): Promise<ServiceTypeDto> {
    const row = await this.serviceTypeRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Service type not found');
    }
    return this.toDto(row);
  }

  async create(dto: CreateServiceTypeDto): Promise<ServiceTypeDto> {
    const name = dto.name?.trim();
    const displayName = dto.displayName?.trim();
    if (!name || !displayName) {
      throw new BadRequestException('name and displayName are required');
    }

    const duplicate = await this.serviceTypeRepository.findOne({ where: { name } });
    if (duplicate) {
      throw new ConflictException('Service type already exists');
    }

    const row = this.serviceTypeRepository.create({
      name,
      displayName,
      description: dto.description?.trim() || null,
      isActive: true,
    });

    const saved = await this.serviceTypeRepository.save(row);
    return this.toDto(saved);
  }

  async update(id: number, dto: CreateServiceTypeDto): Promise<ServiceTypeDto> {
    const row = await this.serviceTypeRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Service type not found');
    }

    const name = dto.name?.trim();
    const displayName = dto.displayName?.trim();
    if (!name || !displayName) {
      throw new BadRequestException('name and displayName are required');
    }

    const duplicate = await this.serviceTypeRepository.findOne({ where: { name } });
    if (duplicate && duplicate.id !== id) {
      throw new ConflictException('Service type name already exists');
    }

    row.name = name;
    row.displayName = displayName;
    row.description = dto.description?.trim() || null;

    const saved = await this.serviceTypeRepository.save(row);
    return this.toDto(saved);
  }

  async delete(id: number): Promise<void> {
    const row = await this.serviceTypeRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Service type not found');
    }

    const commodityCount = await this.commodityRepository.count({ where: { serviceTypeId: id } });
    if (commodityCount > 0) {
      throw new ConflictException('Cannot delete service type with existing commodities');
    }

    await this.serviceTypeRepository.delete(id);
  }

  private toDto(item: ServiceType): ServiceTypeDto {
    return {
      id: item.id,
      name: item.name,
      displayName: item.displayName,
      description: item.description,
      isActive: item.isActive,
    };
  }

  private sanitizeLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) {
      return ServiceTypesService.DEFAULT_LIMIT;
    }
    return Math.min(limit, ServiceTypesService.DEFAULT_LIMIT);
  }
}
