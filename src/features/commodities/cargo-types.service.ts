import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CargoTypeEntity } from './entities/cargo-type.entity';
import { ServiceType } from '../logistics/entities/service-type.entity';
import { CargoTypeDto } from './dto/cargo-type.dto';
import { CreateCargoTypeDto, UpdateCargoTypeDto } from './dto/upsert-cargo-type.dto';

/** Normalize a service-type name / cargo-type code into the catalog token form. */
function normalizeToken(value: string): string {
  return (value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

@Injectable()
export class CargoTypesService {
  constructor(
    @InjectRepository(CargoTypeEntity)
    private readonly cargoTypeRepo: Repository<CargoTypeEntity>,
    @InjectRepository(ServiceType)
    private readonly serviceTypeRepo: Repository<ServiceType>,
  ) {}

  /** Resolve the `service_type_type` discriminator from a numeric service type id. */
  private async resolveServiceTypeType(serviceTypeId: number): Promise<string> {
    const serviceType = await this.serviceTypeRepo.findOne({ where: { id: serviceTypeId } });
    if (!serviceType) {
      throw new NotFoundException(`Service type ${serviceTypeId} not found`);
    }
    return normalizeToken(serviceType.name);
  }

  private toDto(item: CargoTypeEntity): CargoTypeDto {
    return {
      code: item.code,
      displayLabel: item.displayLabel,
      serviceTypeType: item.serviceTypeType,
    };
  }

  async getByServiceType(serviceTypeId: number): Promise<CargoTypeDto[]> {
    const serviceTypeType = await this.resolveServiceTypeType(serviceTypeId);
    const rows = await this.cargoTypeRepo.find({
      where: { serviceTypeType, isActive: true },
      order: { displayLabel: 'ASC' },
    });
    return rows.map((row) => this.toDto(row));
  }

  async create(dto: CreateCargoTypeDto): Promise<CargoTypeDto> {
    const serviceTypeType = await this.resolveServiceTypeType(dto.serviceTypeId);
    const code = normalizeToken(dto.code) || normalizeToken(dto.displayLabel);
    const displayLabel = dto.displayLabel?.trim();
    if (!code || !displayLabel) {
      throw new BadRequestException('Cargo type code and label are required');
    }

    const existing = await this.cargoTypeRepo.findOne({
      where: { serviceTypeType, code },
    });

    // Re-creating a duplicate code just reactivates and updates it.
    const entity = existing ?? this.cargoTypeRepo.create({ serviceTypeType, code });
    entity.displayLabel = displayLabel;
    entity.isActive = true;

    const saved = await this.cargoTypeRepo.save(entity);
    return this.toDto(saved);
  }

  /** Resolve the catalog row for a (serviceTypeId, code) pair or throw 404. */
  private async findOrThrow(serviceTypeId: number, code: string): Promise<CargoTypeEntity> {
    const serviceTypeType = await this.resolveServiceTypeType(serviceTypeId);
    const entity = await this.cargoTypeRepo.findOne({
      where: { serviceTypeType, code: normalizeToken(code) },
    });
    if (!entity) {
      throw new NotFoundException('Cargo type not found');
    }
    return entity;
  }

  async update(
    serviceTypeId: number,
    code: string,
    dto: UpdateCargoTypeDto,
  ): Promise<CargoTypeDto> {
    const entity = await this.findOrThrow(serviceTypeId, code);
    if (dto.displayLabel?.trim()) {
      entity.displayLabel = dto.displayLabel.trim();
    }
    const saved = await this.cargoTypeRepo.save(entity);
    return this.toDto(saved);
  }

  async delete(serviceTypeId: number, code: string): Promise<void> {
    const entity = await this.findOrThrow(serviceTypeId, code);
    await this.cargoTypeRepo.remove(entity);
  }
}
