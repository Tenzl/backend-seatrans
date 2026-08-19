import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceType } from '../logistics/entities/service-type.entity';
import {
  CommodityTypeDto,
  CreateCommodityTypeDto,
  ListCommodityTypesQueryDto,
  UpdateCommodityTypeDto,
} from './dto/commodity-type.dto';
import { CommodityType } from './entities/commodity-type.entity';
import { Commodity } from './entities/commodity.entity';
import {
  FREIGHT_FORWARDING_SERVICE_SLUG,
  toCommodityServiceSlug,
} from './commodity-service-scope';
import {
  COMMODITY_USAGE_CHECKER,
  type CommodityUsageChecker,
} from './ports/commodity-usage.checker';

export interface FreightForwardingCatalogSelection {
  commodityTypeId: number | null;
  commodityTypeName: string | null;
  commodityId: number | null;
  commodityName: string | null;
}

@Injectable()
export class CommodityTypesService {
  static readonly IN_USE_MESSAGE =
    'Commodity Type is currently in use / loại hàng đang được sử dụng';

  constructor(
    @InjectRepository(CommodityType)
    private readonly commodityTypeRepository: Repository<CommodityType>,
    @InjectRepository(ServiceType)
    private readonly serviceTypeRepository: Repository<ServiceType>,
    @Optional()
    @InjectRepository(Commodity)
    private readonly commodityRepository?: Repository<Commodity>,
    @Optional()
    @Inject(COMMODITY_USAGE_CHECKER)
    private readonly usageChecker?: CommodityUsageChecker,
  ) {}

  async resolveFreightForwardingSelection(
    commodityTypeId?: number | null,
    commodityId?: number | null,
  ): Promise<FreightForwardingCatalogSelection> {
    if (commodityTypeId == null && commodityId == null) {
      return {
        commodityTypeId: null,
        commodityTypeName: null,
        commodityId: null,
        commodityName: null,
      };
    }
    const serviceTypes = await this.serviceTypeRepository.find();
    const freightForwarding = serviceTypes.find(
      (serviceType) =>
        toCommodityServiceSlug(serviceType.name) ===
          FREIGHT_FORWARDING_SERVICE_SLUG ||
        toCommodityServiceSlug(serviceType.displayName) ===
          FREIGHT_FORWARDING_SERVICE_SLUG,
    );
    if (!freightForwarding) {
      throw new NotFoundException(
        'Freight Forwarding Service type is not configured',
      );
    }

    const commodityType =
      commodityTypeId == null
        ? null
        : await this.commodityTypeRepository.findOneBy({
            id: commodityTypeId,
          });
    if (
      commodityTypeId != null &&
      (!commodityType || commodityType.serviceTypeId !== freightForwarding.id)
    ) {
      throw new BadRequestException(
        'Commodity Type does not belong to Freight Forwarding Service',
      );
    }

    if (commodityId != null && !this.commodityRepository) {
      throw new BadRequestException('Commodity catalog is not configured');
    }
    const commodity =
      commodityId == null
        ? null
        : await this.commodityRepository!.findOne({
            where: { id: commodityId },
          });
    if (
      commodityId != null &&
      (!commodity || commodity.serviceTypeId !== freightForwarding.id)
    ) {
      throw new BadRequestException(
        'Commodity does not belong to Freight Forwarding Service',
      );
    }

    return {
      commodityTypeId: commodityType?.id ?? null,
      commodityTypeName: commodityType?.name.trim() || null,
      commodityId: commodity?.id ?? null,
      commodityName:
        commodity?.displayName?.trim() || commodity?.name.trim() || null,
    };
  }

  async list(query: ListCommodityTypesQueryDto): Promise<CommodityTypeDto[]> {
    await this.requireServiceType(query.serviceTypeId);
    const rows = await this.commodityTypeRepository.find({
      where: { serviceTypeId: query.serviceTypeId },
      order: { name: 'ASC', id: 'ASC' },
      select: {
        id: true,
        serviceTypeId: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows.map((row) => this.toDto(row));
  }

  async create(dto: CreateCommodityTypeDto): Promise<CommodityTypeDto> {
    await this.requireServiceType(dto.serviceTypeId);
    const name = this.normalizeName(dto.name);
    await this.assertUnique(dto.serviceTypeId, name);

    const row = this.commodityTypeRepository.create({
      serviceTypeId: dto.serviceTypeId,
      name,
    });
    return this.toDto(await this.save(row));
  }

  async update(
    id: number,
    dto: UpdateCommodityTypeDto,
  ): Promise<CommodityTypeDto> {
    await this.requireServiceType(dto.serviceTypeId);
    const row = await this.requireType(id);
    if (row.serviceTypeId !== dto.serviceTypeId) {
      throw new BadRequestException(
        'Commodity Type does not belong to the requested Service',
      );
    }
    if (dto.name === undefined) {
      throw new BadRequestException('No updatable fields on Commodity Type');
    }

    const name = this.normalizeName(dto.name);
    await this.assertUnique(row.serviceTypeId, name, row.id);
    row.name = name;
    return this.toDto(await this.save(row));
  }

  async delete(id: number, serviceTypeId: number): Promise<void> {
    await this.requireServiceType(serviceTypeId);
    const row = await this.requireType(id);
    if (row.serviceTypeId !== serviceTypeId) {
      throw new BadRequestException(
        'Commodity Type does not belong to the requested Service',
      );
    }

    if (
      this.usageChecker?.isTypeInUse &&
      (await this.usageChecker.isTypeInUse({
        id: row.id,
        name: row.name,
      }))
    ) {
      throw new ConflictException(CommodityTypesService.IN_USE_MESSAGE);
    }

    try {
      await this.commodityTypeRepository.delete(id);
    } catch (error) {
      if (this.databaseCode(error) === '23503') {
        throw new ConflictException(CommodityTypesService.IN_USE_MESSAGE);
      }
      throw error;
    }
  }

  private async requireServiceType(id: number): Promise<ServiceType> {
    const serviceType = await this.serviceTypeRepository.findOneBy({ id });
    if (
      !serviceType ||
      serviceType.id !== id ||
      serviceType.isActive === false
    ) {
      throw new NotFoundException('Active Service type not found');
    }
    return serviceType;
  }

  private async requireType(id: number): Promise<CommodityType> {
    const row = await this.commodityTypeRepository.findOne({
      where: { id },
      select: {
        id: true,
        serviceTypeId: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!row) throw new NotFoundException('Commodity Type not found');
    return row;
  }

  private async assertUnique(
    serviceTypeId: number,
    name: string,
    excludeId?: number,
  ): Promise<void> {
    const rows = await this.commodityTypeRepository.find({
      where: { serviceTypeId },
      select: { id: true, name: true },
    });
    const normalizedName = this.comparisonKey(name);
    for (const row of rows) {
      if (row.id === excludeId) continue;
      if (this.comparisonKey(row.name) === normalizedName) {
        throw new ConflictException(
          'Commodity Type name already exists for this Service',
        );
      }
    }
  }

  private normalizeName(value: string): string {
    const normalized = value?.trim().replace(/\s+/g, ' ');
    if (!normalized) throw new BadRequestException('Type name is required');
    return normalized;
  }

  private comparisonKey(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  }

  private async save(row: CommodityType): Promise<CommodityType> {
    try {
      return await this.commodityTypeRepository.save(row);
    } catch (error) {
      if (this.databaseCode(error) === '23505') {
        throw new ConflictException(
          'Commodity Type name already exists for this Service',
        );
      }
      throw error;
    }
  }

  private databaseCode(error: unknown): string | undefined {
    return (error as { driverError?: { code?: string } } | null)?.driverError
      ?.code;
  }

  private toDto(row: CommodityType): CommodityTypeDto {
    return {
      id: row.id,
      serviceTypeId: row.serviceTypeId,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
