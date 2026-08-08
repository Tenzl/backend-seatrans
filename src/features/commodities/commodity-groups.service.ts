import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ServiceType } from '../logistics/entities/service-type.entity';
import { formatCommodityInGroupLabel } from './commodity-display-label';
import {
  FREIGHT_FORWARDING_SERVICE_SLUG,
  isCommodityAdminServiceSlug,
  toCommodityServiceSlug,
  type CommodityAdminServiceSlug,
} from './commodity-service-scope';
import { AddCommodityToGroupDto } from './dto/add-commodity-to-group.dto';
import { BookingCommodityOptionDto } from './dto/booking-commodity-option.dto';
import { CommodityGroupDto } from './dto/commodity-group.dto';
import { CommodityDto } from './dto/commodity.dto';
import { CreateCommodityGroupDto } from './dto/create-commodity-group.dto';
import type { CreateGroupedCommodityDto } from './dto/create-commodity-group.dto';
import { ListCommodityGroupsQueryDto } from './dto/list-commodity-groups-query.dto';
import { UpdateCommodityGroupDto } from './dto/update-commodity-group.dto';
import { CommodityGroup } from './entities/commodity-group.entity';
import { Commodity } from './entities/commodity.entity';
import {
  COMMODITY_USAGE_CHECKER,
  type CommodityUsageChecker,
} from './ports/commodity-usage.checker';
import { CommoditiesService } from './commodities.service';

@Injectable()
export class CommodityGroupsService {
  static readonly GROUP_IN_USE_MESSAGE =
    'Commodity group cannot be deleted because one or more commodities are in use / nhóm đang được sử dụng';

  constructor(
    @InjectRepository(CommodityGroup)
    private readonly groupRepository: Repository<CommodityGroup>,
    @InjectRepository(Commodity)
    private readonly commodityRepository: Repository<Commodity>,
    @InjectRepository(ServiceType)
    private readonly serviceTypeRepository: Repository<ServiceType>,
    @Inject(COMMODITY_USAGE_CHECKER)
    private readonly usageChecker: CommodityUsageChecker,
    private readonly commoditiesService: CommoditiesService,
    private readonly dataSource: DataSource,
  ) {}

  async list(query: ListCommodityGroupsQueryDto = {}): Promise<CommodityGroupDto[]> {
    const serviceTypeId = query.serviceSlug
      ? (await this.requireAdminServiceType(query.serviceSlug)).id
      : null;

    const qb = this.groupRepository
      .createQueryBuilder('grp')
      .leftJoinAndSelect('grp.commodities', 'commodity')
      .orderBy('grp.name', 'ASC')
      .addOrderBy('commodity.name', 'ASC');

    if (serviceTypeId != null) {
      qb.andWhere('grp.service_type_id = :serviceTypeId', { serviceTypeId });
    } else {
      const allowedIds = await this.adminServiceTypeIds();
      if (allowedIds.length === 0) return [];
      qb.andWhere('grp.service_type_id IN (:...allowedIds)', { allowedIds });
    }

    const search = query.q?.trim();
    if (search) {
      qb.andWhere(
        '(LOWER(grp.name) LIKE :q OR LOWER(commodity.name) LIKE :q OR LOWER(commodity.display_name) LIKE :q)',
        { q: `%${search.toLowerCase()}%` },
      );
    }

    const groups = await qb.getMany();
    const slugByServiceTypeId = await this.serviceSlugByIdMap();
    return groups.map((group) => this.toGroupDto(group, slugByServiceTypeId));
  }

  async getById(id: number): Promise<CommodityGroupDto> {
    const group = await this.groupRepository.findOne({
      where: { id },
      relations: { commodities: true },
      order: { commodities: { name: 'ASC' } },
    });
    if (!group) {
      throw new NotFoundException('Commodity group not found');
    }
    await this.assertAdminServiceType(group.serviceTypeId);
    const slugByServiceTypeId = await this.serviceSlugByIdMap();
    return this.toGroupDto(group, slugByServiceTypeId);
  }

  async create(dto: CreateCommodityGroupDto): Promise<CommodityGroupDto> {
    const serviceType = await this.requireAdminServiceType(dto.serviceSlug);
    const groupName = dto.name?.trim();
    if (!groupName) {
      throw new BadRequestException('Group name is required');
    }
    if (!dto.commodities?.length) {
      throw new BadRequestException(
        'Create group requires at least one commodity',
      );
    }

    const duplicateGroup = await this.groupRepository.findOne({
      where: { serviceTypeId: serviceType.id, name: groupName },
    });
    if (duplicateGroup) {
      throw new ConflictException(
        'Commodity group already exists for this service type',
      );
    }

    const prepared = dto.commodities.map((item) =>
      this.prepareCommodityInput(item),
    );
    this.assertNoDuplicateNamesInRequest(prepared);

    const saved = await this.dataSource.transaction(async (manager) => {
      const groupRepo = manager.getRepository(CommodityGroup);
      const commodityRepo = manager.getRepository(Commodity);

      const group = await groupRepo.save(
        groupRepo.create({
          serviceTypeId: serviceType.id,
          name: groupName,
        }),
      );

      for (const item of prepared) {
        const clash = await commodityRepo.findOne({
          where: { groupId: group.id, name: item.name },
        });
        if (clash) {
          throw new ConflictException(
            `Commodity "${item.name}" already exists in this group`,
          );
        }
        await commodityRepo.save(
          commodityRepo.create({
            serviceTypeId: serviceType.id,
            groupId: group.id,
            name: item.name,
            displayName: item.displayName,
            description: item.description,
            requiredImageCount: item.requiredImageCount,
            cargoType: item.cargoType,
          }),
        );
      }

      return groupRepo.findOneOrFail({
        where: { id: group.id },
        relations: { commodities: true },
        order: { commodities: { name: 'ASC' } },
      });
    });

    const slugByServiceTypeId = await this.serviceSlugByIdMap();
    return this.toGroupDto(saved, slugByServiceTypeId);
  }

  async addCommodity(
    groupId: number,
    dto: AddCommodityToGroupDto,
  ): Promise<CommodityDto> {
    const group = await this.groupRepository.findOne({ where: { id: groupId } });
    if (!group) {
      throw new NotFoundException('Commodity group not found');
    }
    await this.assertAdminServiceType(group.serviceTypeId);

    const prepared = this.prepareCommodityInput(dto);
    const clash = await this.commodityRepository.findOne({
      where: { groupId: group.id, name: prepared.name },
    });
    if (clash) {
      throw new ConflictException(
        'Commodity already exists in this group',
      );
    }

    const saved = await this.commodityRepository.save(
      this.commodityRepository.create({
        serviceTypeId: group.serviceTypeId,
        groupId: group.id,
        name: prepared.name,
        displayName: prepared.displayName,
        description: prepared.description,
        requiredImageCount: prepared.requiredImageCount,
        cargoType: prepared.cargoType,
      }),
    );

    return this.commoditiesService.toDto({
      ...saved,
      group,
    } as Commodity);
  }

  async update(
    id: number,
    dto: UpdateCommodityGroupDto,
  ): Promise<CommodityGroupDto> {
    const group = await this.groupRepository.findOne({ where: { id } });
    if (!group) {
      throw new NotFoundException('Commodity group not found');
    }
    await this.assertAdminServiceType(group.serviceTypeId);

    if (dto.name === undefined) {
      throw new BadRequestException('No updatable fields on commodity group');
    }

    const groupName = dto.name.trim();
    if (!groupName) {
      throw new BadRequestException('Group name is required');
    }

    if (groupName !== group.name) {
      const duplicate = await this.groupRepository.findOne({
        where: { serviceTypeId: group.serviceTypeId, name: groupName },
      });
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(
          'Commodity group already exists for this service type',
        );
      }

      group.name = groupName;
      try {
        await this.groupRepository.save(group);
      } catch (error) {
        const databaseCode = (
          error as { driverError?: { code?: string } } | null
        )?.driverError?.code;
        if (databaseCode === '23505') {
          throw new ConflictException(
            'Commodity group already exists for this service type',
          );
        }
        throw error;
      }
    }

    return this.getById(id);
  }

  async delete(id: number): Promise<void> {
    const group = await this.groupRepository.findOne({
      where: { id },
      relations: { commodities: true },
    });
    if (!group) {
      throw new NotFoundException('Commodity group not found');
    }
    await this.assertAdminServiceType(group.serviceTypeId);

    const members = group.commodities ?? [];
    for (const commodity of members) {
      if (
        await this.usageChecker.isInUse({
          id: commodity.id,
          name: commodity.name,
          displayName: commodity.displayName,
          groupName: group.name,
        })
      ) {
        throw new ConflictException(CommodityGroupsService.GROUP_IN_USE_MESSAGE);
      }
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        if (members.length > 0) {
          await manager.getRepository(Commodity).delete({ groupId: id });
        }
        await manager.getRepository(CommodityGroup).delete(id);
      });
    } catch (error) {
      const databaseCode = (error as { driverError?: { code?: string } } | null)
        ?.driverError?.code;
      if (databaseCode === '23503') {
        throw new ConflictException(CommodityGroupsService.GROUP_IN_USE_MESSAGE);
      }
      throw error;
    }
  }

  /** Freight-forwarding only — lightweight picker for booking form. */
  async listBookingOptions(): Promise<BookingCommodityOptionDto[]> {
    const serviceType = await this.requireAdminServiceType(
      FREIGHT_FORWARDING_SERVICE_SLUG,
    );

    const commodities = await this.commodityRepository
      .createQueryBuilder('commodity')
      .innerJoinAndSelect('commodity.group', 'grp')
      .where('commodity.service_type_id = :serviceTypeId', {
        serviceTypeId: serviceType.id,
      })
      .andWhere('commodity.group_id IS NOT NULL')
      .orderBy('grp.name', 'ASC')
      .addOrderBy('commodity.display_name', 'ASC')
      .getMany();

    return commodities.map((commodity) => {
      const commodityName = commodity.displayName?.trim() || commodity.name;
      const groupName = commodity.group?.name?.trim() || '';
      return {
        id: commodity.id,
        commodityName,
        groupName,
        displayLabel: formatCommodityInGroupLabel(commodityName, groupName),
      };
    });
  }

  async resolveDisplayLabel(commodityId: number): Promise<string | null> {
    const commodity = await this.commodityRepository.findOne({
      where: { id: commodityId },
      relations: { group: true },
    });
    if (!commodity) return null;
    const commodityName = commodity.displayName?.trim() || commodity.name;
    const groupName = commodity.group?.name?.trim() || '';
    return formatCommodityInGroupLabel(commodityName, groupName);
  }

  private prepareCommodityInput(dto: CreateGroupedCommodityDto | AddCommodityToGroupDto): {
    name: string;
    displayName: string;
    description: string | null;
    requiredImageCount: number;
    cargoType: string;
  } {
    const name = dto.name?.trim();
    const displayName = dto.displayName?.trim();
    if (!name || !displayName) {
      throw new BadRequestException(
        'Commodity name and displayName are required',
      );
    }
    return {
      name,
      displayName,
      description: dto.description?.trim() || null,
      requiredImageCount: dto.requiredImageCount ?? 18,
      cargoType: this.commoditiesService.normalizeCargoTypePublic(dto.cargoType),
    };
  }

  private assertNoDuplicateNamesInRequest(
    items: Array<{ name: string }>,
  ): void {
    const seen = new Set<string>();
    for (const item of items) {
      const key = item.name.toLowerCase();
      if (seen.has(key)) {
        throw new BadRequestException(
          `Duplicate commodity name "${item.name}" in create request`,
        );
      }
      seen.add(key);
    }
  }

  private async requireAdminServiceType(
    serviceSlug: CommodityAdminServiceSlug,
  ): Promise<ServiceType> {
    if (!isCommodityAdminServiceSlug(serviceSlug)) {
      throw new BadRequestException(
        `Unsupported service slug "${serviceSlug}". Allowed: shipping-agency, freight-forwarding`,
      );
    }
    const rows = await this.serviceTypeRepository.find();
    const match = rows.find(
      (row) =>
        toCommodityServiceSlug(row.name) === serviceSlug ||
        toCommodityServiceSlug(row.displayName) === serviceSlug,
    );
    if (!match) {
      throw new NotFoundException(
        `Service type not found for slug "${serviceSlug}"`,
      );
    }
    return match;
  }

  private async assertAdminServiceType(serviceTypeId: number): Promise<void> {
    const allowed = await this.adminServiceTypeIds();
    if (!allowed.includes(serviceTypeId)) {
      throw new BadRequestException(
        'Commodity groups are only supported for shipping-agency and freight-forwarding',
      );
    }
  }

  private async adminServiceTypeIds(): Promise<number[]> {
    const rows = await this.serviceTypeRepository.find();
    return rows
      .filter((row) =>
        isCommodityAdminServiceSlug(toCommodityServiceSlug(row.name)) ||
        isCommodityAdminServiceSlug(toCommodityServiceSlug(row.displayName)),
      )
      .map((row) => row.id);
  }

  private async serviceSlugByIdMap(): Promise<Map<number, string>> {
    const rows = await this.serviceTypeRepository.find();
    const map = new Map<number, string>();
    for (const row of rows) {
      map.set(row.id, toCommodityServiceSlug(row.name));
    }
    return map;
  }

  private toGroupDto(
    group: CommodityGroup,
    slugByServiceTypeId: Map<number, string>,
  ): CommodityGroupDto {
    const commodities = [...(group.commodities ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return {
      id: group.id,
      serviceTypeId: group.serviceTypeId,
      serviceSlug:
        slugByServiceTypeId.get(group.serviceTypeId) ??
        String(group.serviceTypeId),
      name: group.name,
      commodities: commodities.map((item) =>
        this.commoditiesService.toDto({
          ...item,
          group,
        } as Commodity),
      ),
      createdAt: group.createdAt?.toISOString?.() ?? String(group.createdAt),
      updatedAt: group.updatedAt?.toISOString?.() ?? String(group.updatedAt),
    };
  }
}
