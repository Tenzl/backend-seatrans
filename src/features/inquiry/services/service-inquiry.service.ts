import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BaseInquiry } from '../entities/base-inquiry.entity';
import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';
import { CharteringBrokerageInquiryEntity } from '../entities/chartering-brokerage-inquiry.entity';
import { FreightForwardingInquiryEntity } from '../entities/freight-forwarding-inquiry.entity';
import { TotalLogisticsInquiryEntity } from '../entities/total-logistics-inquiry.entity';
import { SpecialRequestInquiryEntity } from '../entities/special-request-inquiry.entity';
import { InquiryFieldChangeLog } from '../entities/inquiry-field-change-log.entity';
import { ServiceType } from '../../logistics/entities/service-type.entity';
import { User } from '../../auth/entities/user.entity';
import { PublicInquiryRequestDto } from '../dto/public-inquiry-request.dto';
import { InquiryStatus } from '../enums/inquiry-status.enum';
import {
  ListInquiriesQueryDto,
  type InquiryArchivedFilter,
} from '../dto/list-inquiries-query.dto';
import { UpdateInquiryStatusDto } from '../dto/update-inquiry-status.dto';
import { UpdateInquiryFormDto } from '../dto/update-inquiry-form.dto';
import { UpdateInquiryHoursDto } from '../dto/update-inquiry-hours.dto';
import { InquiryDocumentService } from './inquiry-document.service';
import { InquiryCreatedSource } from '../enums/inquiry-created-source.enum';
import { NotificationService } from '../../notification/notification.service';
import { buildCustomerSubmittedSnapshot } from '../utils/customer-submitted-snapshot.util';
import { InquiryRepositoryRegistry } from './inquiry-repository.registry';
import { InquiryQueryService } from './inquiry-query.service';

@Injectable()
export class ServiceInquiryService {
  private readonly logger = new Logger(ServiceInquiryService.name);

  constructor(
    private readonly repositories: InquiryRepositoryRegistry,
    private readonly queries: InquiryQueryService,
    @InjectRepository(ServiceType)
    private readonly serviceTypeRepository: Repository<ServiceType>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly inquiryDocumentService: InquiryDocumentService,
    private readonly notificationService: NotificationService,
  ) {}

  async submitInquiry(
    dto: PublicInquiryRequestDto,
    files: Express.Multer.File[],
    currentUserId: number,
  ): Promise<{ message: string; serviceSlug: string; targetId: number }> {
    const currentUser = await this.userRepository.findOne({
      where: { id: currentUserId },
    });
    if (!currentUser) {
      throw new BadRequestException('User not found. Please log in again.');
    }

    if (!currentUser.fullName?.trim() || !currentUser.email?.trim()) {
      throw new BadRequestException(
        'Please complete your profile before submitting an inquiry.',
      );
    }

    const serviceType = await this.resolveServiceType(
      dto.serviceTypeId,
      dto.serviceTypeSlug,
    );
    const slug = this.repositories.toSlug(serviceType.name);

    const common = {
      serviceType,
      user: currentUser,
      fullName: this.trimToNull(dto.fullName) ?? currentUser.fullName,
      email: this.trimToNull(dto.email) ?? currentUser.email,
      phone: this.trimToNull(dto.phone) ?? currentUser.phone,
      company: this.trimToNull(dto.company) ?? currentUser.company,
      status: InquiryStatus.PENDING,
      notes: this.trimToNull(dto.notes),
      createdSource: InquiryCreatedSource.CUSTOMER_PORTAL,
      details: dto.details ?? null,
    };

    const saved = await this.createWithAllocatedCode(
      slug,
      serviceType.name,
      common,
      dto,
    );

    if (files.length) {
      try {
        await this.inquiryDocumentService.saveAttachmentsForInquiry(
          saved,
          files,
          currentUserId,
        );
      } catch (error) {
        await this.compensateFailedSubmission(slug, saved.id, error);
        throw new ServiceUnavailableException(
          'Could not save inquiry attachments. Please try again.',
        );
      }
    }

    try {
      await this.notificationService.notifyInternalNewInquiry(saved);
    } catch (error) {
      // Notification is a post-commit side effect. A delivery failure must not
      // turn an already-persisted customer inquiry into a false HTTP failure.
      this.logger.error(
        `Failed to notify internal users about inquiry ${saved.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return {
      message: 'Inquiry submitted successfully.',
      serviceSlug: slug,
      targetId: saved.id,
    };
  }

  /**
   * Serializes code allocation per service/year and inserts the inquiry on the
   * same database connection. The transaction-scoped advisory lock closes the
   * read-last/insert race without holding a table lock.
   */
  private async createWithAllocatedCode(
    slug: string,
    serviceName: string,
    common: Record<string, unknown>,
    dto: PublicInquiryRequestDto,
  ): Promise<BaseInquiry> {
    const owningRepository = this.repositories.forSlug(slug);
    const prefix = this.repositories.codePrefix(serviceName);

    return owningRepository.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `inquiry-code:${prefix}`,
      ]);

      const code = await this.generateCodeForPrefix(
        prefix,
        this.repositories.forSlug(slug, manager),
      );
      return this.createForSlug(slug, { ...common, code }, dto, manager);
    });
  }

  private async compensateFailedSubmission(
    slug: string,
    inquiryId: number,
    attachmentError: unknown,
  ): Promise<void> {
    try {
      await this.repositories.forSlug(slug).delete(inquiryId);
    } catch (cleanupError) {
      this.logger.error(
        `Attachment persistence failed and inquiry ${inquiryId} could not be removed`,
        cleanupError instanceof Error
          ? cleanupError.stack
          : String(cleanupError),
      );
    }

    this.logger.error(
      `Attachment persistence failed for inquiry ${inquiryId}; submission was not accepted`,
      attachmentError instanceof Error
        ? attachmentError.stack
        : String(attachmentError),
    );
  }

  private async createForSlug(
    slug: string,
    common: Record<string, unknown>,
    dto: PublicInquiryRequestDto,
    manager?: EntityManager,
  ): Promise<BaseInquiry> {
    switch (slug) {
      case 'shipping-agency': {
        const repo = this.repositories.forSlug(
          slug,
          manager,
        ) as Repository<ShippingAgencyInquiryEntity>;
        const row = repo.create({
          ...common,
          quoteForm: 'HCM',
          berthHours: null,
          anchorageHours: null,
          pilotage3rdMiles: null,
          toName: this.trimToNull(dto.shipownerTo),
          mv: this.trimToNull(dto.vesselName),
          grt: this.toNumericString(dto.grt),
          dwt: this.toNumericString(dto.dwt),
          loa: this.toNumericString(dto.loa),
          eta: this.toDateOnly(dto.eta),
          cargoType: this.trimToNull(dto.cargoType),
          cargoName: this.trimToNull(dto.cargoName),
          cargoNameOther: this.trimToNull(dto.cargoNameOther),
          cargoQuantity:
            this.trimToNull(dto.cargoQuantity) ??
            this.toNumericString(dto.quantityTons),
          frtTaxType: this.trimToNull(dto.frtTaxType),
          purposeOfCalling: this.trimToNull(dto.purposeOfCalling),
          portOfCall: this.trimToNull(dto.portOfCall),
          dischargeLoadingLocation: this.trimToNull(
            dto.dischargeLoadingLocation,
          ),
          boatHireAmount: this.toNumericString(dto.boatHireAmount),
          tallyFeeAmount: this.toNumericString(dto.tallyFeeAmount),
          transportLs: this.trimToNull(dto.transportLs),
          transportQuarantine: this.trimToNull(dto.transportQuarantine),
        } as Partial<ShippingAgencyInquiryEntity>);
        row.customerSubmittedSnapshot = buildCustomerSubmittedSnapshot(row);
        return repo.save(row);
      }
      case 'chartering': {
        const repo = this.repositories.forSlug(
          slug,
          manager,
        ) as Repository<CharteringBrokerageInquiryEntity>;
        const row = repo.create({
          ...common,
          cargoQuantity:
            this.trimToNull(dto.cargoQuantity) ??
            this.toNumericString(dto.quantityTons),
          loadingPort: this.trimToNull(dto.loadingPort),
          dischargingPort: this.trimToNull(dto.dischargingPort),
          laycanFrom: this.toDateOnly(dto.laycanFrom),
          laycanTo: this.toDateOnly(dto.laycanTo),
        } as Partial<CharteringBrokerageInquiryEntity>);
        return repo.save(row);
      }
      case 'freight-forwarding': {
        const repo = this.repositories.forSlug(
          slug,
          manager,
        ) as Repository<FreightForwardingInquiryEntity>;
        const row = repo.create({
          ...common,
          cargoName: this.trimToNull(dto.cargoName),
          deliveryTerm: this.trimToNull(dto.deliveryTerm),
          container20ft: dto.container20 ?? null,
          container40ft: dto.container40 ?? null,
          loadingPort: this.trimToNull(dto.loadingPort),
          dischargingPort: this.trimToNull(dto.dischargingPort),
          shipmentFrom: this.toDateOnly(dto.shipmentFrom),
          shipmentTo: this.toDateOnly(dto.shipmentTo),
        } as Partial<FreightForwardingInquiryEntity>);
        return repo.save(row);
      }
      case 'total-logistic': {
        const repo = this.repositories.forSlug(
          slug,
          manager,
        ) as Repository<TotalLogisticsInquiryEntity>;
        const row = repo.create({
          ...common,
          cargoName: this.trimToNull(dto.cargoName),
          deliveryTerm: this.trimToNull(dto.deliveryTerm),
          container20ft: dto.container20 ?? null,
          container40ft: dto.container40 ?? null,
          loadingPort: this.trimToNull(dto.loadingPort),
          dischargingPort: this.trimToNull(dto.dischargingPort),
          shipmentFrom: this.toDateOnly(dto.shipmentFrom),
          shipmentTo: this.toDateOnly(dto.shipmentTo),
        } as Partial<TotalLogisticsInquiryEntity>);
        return repo.save(row);
      }
      case 'special-request': {
        const repo = this.repositories.forSlug(
          slug,
          manager,
        ) as Repository<SpecialRequestInquiryEntity>;
        const row = repo.create({
          ...common,
          subject: this.trimToNull(dto.subject),
          message: this.trimToNull(dto.message),
          preferredProvinceId: dto.preferredProvinceId ?? null,
          relatedDepartmentId: dto.relatedDepartmentId ?? null,
        } as Partial<SpecialRequestInquiryEntity>);
        return repo.save(row);
      }
      default:
        throw new BadRequestException(`Unsupported service type: ${slug}`);
    }
  }

  async listByUser(
    userId: number,
    query: ListInquiriesQueryDto,
  ): Promise<{
    content: unknown[];
    totalElements: number;
    totalPages: number;
    size: number;
    number: number;
  }> {
    const serviceTypeFilter =
      query.serviceType?.trim() || query.serviceSlug?.trim();
    const serviceType =
      await this.resolveServiceTypeFromFilter(serviceTypeFilter);
    return this.queries.list(
      {
        user: { id: userId },
        status: query.status,
        serviceType: serviceType ?? undefined,
      },
      query,
      'user',
    );
  }

  async listForAdmin(
    query: ListInquiriesQueryDto,
    opts: { includeArchived?: boolean } = {},
  ): Promise<{
    content: unknown[];
    totalElements: number;
    totalPages: number;
    size: number;
    number: number;
  }> {
    const serviceTypeFilter =
      query.serviceType?.trim() || query.serviceSlug?.trim();
    const serviceType =
      await this.resolveServiceTypeFromFilter(serviceTypeFilter);
    const archivedFilter = opts.includeArchived
      ? this.normalizeArchivedFilter(query.archived)
      : 'active';
    return this.queries.list(
      {
        status: query.status,
        serviceType: serviceType ?? undefined,
        archivedFilter,
      },
      query,
      'admin',
    );
  }

  async getByServiceAndId(
    serviceTypeName: string,
    id: number,
  ): Promise<unknown> {
    const row = await this.queries.require(serviceTypeName, id);
    return this.queries.toResponse(row, 'admin');
  }

  async updateStatus(
    serviceTypeName: string,
    id: number,
    dto: UpdateInquiryStatusDto,
  ): Promise<unknown> {
    const { row, repo } = await this.queries.requireWithRepository(
      serviceTypeName,
      id,
    );
    const previousStatus = row.status;
    row.status = dto.status;

    const saved = await repo.save(row);
    await this.notificationService.notifyStatusChanged(saved, previousStatus);
    await this.notificationService.notifyInquiryQuotedIfNeeded(
      saved,
      previousStatus,
    );
    return this.queries.toResponse(saved, 'admin');
  }

  async updateForm(
    serviceTypeName: string,
    id: number,
    dto: UpdateInquiryFormDto,
  ): Promise<unknown> {
    if (!this.repositories.isShippingAgency(serviceTypeName)) {
      throw new BadRequestException(
        'Quote form update only supported for shipping agency',
      );
    }
    const row = await this.queries.requireShippingAgency(id);
    row.quoteForm = dto.form.trim().toUpperCase();
    const saved = await this.repositories.shippingAgency.save(row);
    return this.queries.toResponse(saved, 'admin');
  }

  async updateHours(
    serviceTypeName: string,
    id: number,
    dto: UpdateInquiryHoursDto,
  ): Promise<unknown> {
    if (!this.repositories.isShippingAgency(serviceTypeName)) {
      throw new BadRequestException(
        'Hours update only supported for shipping agency',
      );
    }
    const row = await this.queries.requireShippingAgency(id);

    if (dto.berthHours != null) {
      row.berthHours = this.toNumericString(dto.berthHours);
    }
    if (dto.anchorageHours != null) {
      row.anchorageHours = this.toNumericString(dto.anchorageHours);
    }
    if (dto.pilotage3rdMiles != null) {
      row.pilotage3rdMiles = this.toNumericString(dto.pilotage3rdMiles);
    }

    const saved = await this.repositories.shippingAgency.save(row);
    return this.queries.toResponse(saved, 'admin');
  }

  /**
   * Remove every child row that references an inquiry so it can be deleted
   * cleanly. Field-change logs only exist for shipping agency; documents are
   * keyed by the (globally-unique) inquiry id.
   */
  private async deleteInquiryChildren(
    slug: string,
    inquiryId: number,
    manager: EntityManager,
  ): Promise<string[]> {
    if (slug === 'shipping-agency') {
      await manager.getRepository(InquiryFieldChangeLog).delete({ inquiryId });
    }
    return this.inquiryDocumentService.removeMetadataByInquiry(
      inquiryId,
      manager,
    );
  }

  async softDeleteBatch(
    ids: number[],
    deletedByUserId: number,
    serviceSlug?: string,
  ): Promise<{ deletedCount: number }> {
    return this.repositories.shippingAgency.manager.transaction(
      async (manager) => {
        const found = await this.queries.findRows(
          ids,
          {
            includeDeleted: false,
            serviceSlug,
          },
          manager,
        );
        if (found.length !== ids.length) {
          throw new NotFoundException('One or more inquiries were not found');
        }

        const now = new Date();
        for (const { row, repo } of found) {
          row.deletedAt = now;
          row.deletedById = deletedByUserId;
          await repo.save(row);
        }

        return { deletedCount: found.length };
      },
    );
  }

  async softDeleteBatchByUser(
    userId: number,
    ids: number[],
    serviceSlug: string,
  ): Promise<{ deletedCount: number }> {
    return this.repositories.shippingAgency.manager.transaction(
      async (manager) => {
        const found = await this.queries.findRows(
          ids,
          {
            includeDeleted: false,
            serviceSlug,
          },
          manager,
        );

        if (
          found.length !== ids.length ||
          found.some((f) => f.row.userId !== userId)
        ) {
          throw new ForbiddenException(
            'You can only delete your own inquiries',
          );
        }

        const now = new Date();
        for (const { row, repo } of found) {
          row.deletedAt = now;
          row.deletedById = userId;
          await repo.save(row);
        }

        return { deletedCount: found.length };
      },
    );
  }

  async softDeleteBatchByAdmin(
    ids: number[],
    deletedByUserId: number,
    serviceSlug?: string,
  ): Promise<{ deletedCount: number }> {
    return this.softDeleteBatch(ids, deletedByUserId, serviceSlug);
  }

  async hardDeleteByServiceAndId(
    serviceTypeName: string,
    id: number,
  ): Promise<void> {
    const publicIds =
      await this.repositories.shippingAgency.manager.transaction(
        async (manager) => {
          const { row, repo, slug } = await this.queries.requireWithRepository(
            serviceTypeName,
            id,
            {
              includeDeleted: true,
            },
            manager,
          );
          const storedObjectIds = await this.deleteInquiryChildren(
            slug,
            row.id,
            manager,
          );
          await repo.remove(row);
          return storedObjectIds;
        },
      );
    await this.inquiryDocumentService.deleteStoredObjectsBestEffort(publicIds);
  }

  async hardDeleteBatchByAdmin(
    ids: number[],
    serviceSlug?: string,
  ): Promise<{ deletedCount: number }> {
    const result = await this.repositories.shippingAgency.manager.transaction(
      async (manager) => {
        const found = await this.queries.findRows(
          ids,
          {
            includeDeleted: true,
            serviceSlug,
          },
          manager,
        );

        if (found.length !== ids.length) {
          throw new NotFoundException('One or more inquiries were not found');
        }

        const publicIds: string[] = [];
        for (const { row, repo, slug } of found) {
          publicIds.push(
            ...(await this.deleteInquiryChildren(slug, row.id, manager)),
          );
          await repo.remove(row);
        }

        return { deletedCount: found.length, publicIds };
      },
    );
    await this.inquiryDocumentService.deleteStoredObjectsBestEffort(
      result.publicIds,
    );
    return { deletedCount: result.deletedCount };
  }

  async restoreBatchByAdmin(
    ids: number[],
    serviceSlug?: string,
  ): Promise<{ restoredCount: number }> {
    return this.repositories.shippingAgency.manager.transaction(
      async (manager) => {
        const found = await this.queries.findRows(
          ids,
          {
            includeDeleted: true,
            serviceSlug,
          },
          manager,
        );

        if (found.length !== ids.length) {
          throw new NotFoundException('One or more inquiries were not found');
        }

        for (const { row, repo } of found) {
          row.deletedAt = null;
          row.deletedById = null;
          await repo.save(row);
        }

        return { restoredCount: found.length };
      },
    );
  }

  async restoreByServiceAndId(
    serviceTypeName: string,
    id: number,
  ): Promise<void> {
    await this.repositories.shippingAgency.manager.transaction(
      async (manager) => {
        const { row, repo } = await this.queries.requireWithRepository(
          serviceTypeName,
          id,
          {
            includeDeleted: true,
          },
          manager,
        );
        row.deletedAt = null;
        row.deletedById = null;
        await repo.save(row);
      },
    );
  }

  private normalizeArchivedFilter(
    value?: string | null,
  ): InquiryArchivedFilter {
    if (value === 'all' || value === 'archived') return value;
    return 'active';
  }

  private async resolveServiceType(
    serviceTypeId?: number,
    serviceTypeSlug?: string,
  ): Promise<ServiceType> {
    if (serviceTypeId != null) {
      const byId = await this.serviceTypeRepository.findOne({
        where: { id: serviceTypeId },
      });
      if (!byId) {
        throw new BadRequestException('Invalid service type ID');
      }
      return byId;
    }

    if (!serviceTypeSlug?.trim()) {
      throw new BadRequestException(
        'Either serviceTypeId or serviceTypeSlug is required',
      );
    }

    return this.resolveServiceTypeByAnyName(serviceTypeSlug);
  }

  private async resolveServiceTypeFromFilter(
    serviceType?: string,
  ): Promise<ServiceType | null> {
    if (!serviceType?.trim()) {
      return null;
    }
    return this.resolveServiceTypeByAnyName(serviceType);
  }

  private async resolveServiceTypeByAnyName(
    value: string,
  ): Promise<ServiceType> {
    const normalizedName = this.repositories.toServiceName(value);

    const serviceType = await this.serviceTypeRepository
      .createQueryBuilder('serviceType')
      .where('LOWER(serviceType.name) = :name', {
        name: normalizedName.toLowerCase(),
      })
      .getOne();

    if (!serviceType) {
      throw new BadRequestException(`Unsupported service type: ${value}`);
    }

    return serviceType;
  }

  private trimToNull(value?: string | null): string | null {
    if (value == null) {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private toDateOnly(value?: string): string | null {
    if (!value?.trim()) {
      return null;
    }

    return value.trim();
  }

  private toNumericString(value?: number): string | null {
    if (value == null || Number.isNaN(value)) {
      return null;
    }

    return String(value);
  }

  private async generateCodeForPrefix(
    prefix: string,
    repo: Repository<BaseInquiry>,
  ): Promise<string> {
    const last = await repo
      .createQueryBuilder('inquiry')
      .select(
        'MAX(CAST(SUBSTRING(inquiry.code FROM CHAR_LENGTH(:codePrefix) + 1) AS BIGINT))',
        'lastNumber',
      )
      .where(
        "inquiry.code LIKE :prefixPattern AND SUBSTRING(inquiry.code FROM CHAR_LENGTH(:codePrefix) + 1) ~ '^[0-9]+$'",
        {
          codePrefix: prefix,
          prefixPattern: `${prefix}%`,
        },
      )
      .getRawOne<{ lastNumber: string | null }>();

    // BigInt avoids rollover/precision bugs when the sequence grows beyond
    // four digits; padStart preserves the existing display format.
    const nextNumber = BigInt(last?.lastNumber ?? '0') + 1n;

    return `${prefix}${String(nextNumber).padStart(4, '0')}`;
  }
}
