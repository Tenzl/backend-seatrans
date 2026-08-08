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
import {
  InquiryIdempotencyService,
  type InquirySubmitResult,
} from './inquiry-idempotency.service';
import { InquirySubmissionLifecycle } from './inquiry-submission-lifecycle';

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
    private readonly idempotencyService: InquiryIdempotencyService,
    private readonly submissionLifecycle: InquirySubmissionLifecycle,
  ) {}

  async submitInquiry(
    dto: PublicInquiryRequestDto,
    files: Express.Multer.File[],
    currentUserId: number,
    idempotencyKey?: string | null,
  ): Promise<InquirySubmitResult> {
    const normalizedKey = idempotencyKey?.trim() || null;
    const requestHash = normalizedKey
      ? this.idempotencyService.hashSubmitRequest(
          dto as unknown as Record<string, unknown>,
          files,
        )
      : null;

    if (normalizedKey && requestHash) {
      const prior = await this.idempotencyService.beginSubmit(
        currentUserId,
        normalizedKey,
        requestHash,
      );
      if (prior) {
        return prior;
      }
    }

    try {
      const result = await this.executeSubmitInquiry(
        dto,
        files,
        currentUserId,
      );
      if (normalizedKey) {
        await this.idempotencyService.completeSubmit(
          currentUserId,
          normalizedKey,
          result,
        );
      }
      return result;
    } catch (error) {
      if (normalizedKey) {
        await this.idempotencyService.abandonSubmit(
          currentUserId,
          normalizedKey,
        );
      }
      throw error;
    }
  }

  private async executeSubmitInquiry(
    dto: PublicInquiryRequestDto,
    files: Express.Multer.File[],
    currentUserId: number,
  ): Promise<InquirySubmitResult> {
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

    const saved = await this.submissionLifecycle.createWithAllocatedCode(
      slug,
      serviceType.name,
      (manager, code) =>
        this.createForSlug(slug, { ...common, code }, dto, manager),
    );

    if (files.length) {
      try {
        await this.inquiryDocumentService.saveAttachmentsForInquiry(
          saved,
          files,
          currentUserId,
        );
      } catch (error) {
        await this.submissionLifecycle.compensateFailedSubmission(
          slug,
          saved.id,
          error,
        );
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

  private static readonly BATCH_CHUNK_SIZE = 100;

  /**
   * Remove every child row that references an inquiry so it can be deleted
   * cleanly. Field-change logs only exist for shipping agency; documents are
   * keyed by (service_slug, target_id) because ids can collide across services.
   * Notifications use bare inquiry_id + metadata.serviceSlug — clean both in
   * this transaction so hard-delete does not orphan notification rows.
   */
  private async deleteInquiryChildren(
    slug: string,
    inquiryIds: number | number[],
    manager: EntityManager,
  ): Promise<string[]> {
    const ids = Array.isArray(inquiryIds) ? inquiryIds : [inquiryIds];
    if (!ids.length) return [];
    // Pass text[] → bigint[] so node-pg/TypeORM never mis-bind JS number[].
    const idParams = ids.map(String);
    if (slug === 'shipping-agency') {
      await manager.query(
        `DELETE FROM shipping_agency_field_change_logs
         WHERE inquiry_id = ANY($1::bigint[])`,
        [idParams],
      );
    }
    await manager.query(
      `DELETE FROM inquiry_idempotency_keys
       WHERE inquiry_id = ANY($1::bigint[])
         AND (service_slug = $2 OR service_slug IS NULL)`,
      [idParams, slug],
    );
    // Scope by serviceSlug: inquiry ids were not globally unique historically.
    // Match exact slug always. Also remove legacy rows with null/empty slug
    // only when those ids are absent from every other service table — avoids
    // wiping another service's null-slug notification on id collision.
    const otherTables = this.repositories.sources
      .filter((source) => source.slug !== slug)
      .map((source) => source.tableName);
    const otherIdExistsSql = otherTables.length
      ? otherTables
          .map(
            (tableName) =>
              `SELECT 1 FROM ${tableName} o WHERE o.id = n.inquiry_id`,
          )
          .join(' UNION ALL ')
      : 'SELECT 1 WHERE FALSE';
    await manager.query(
      `DELETE FROM notifications n
       WHERE n.inquiry_id = ANY($1::bigint[])
         AND (
           n.metadata->>'serviceSlug' = $2
           OR (
             (n.metadata->>'serviceSlug' IS NULL
               OR BTRIM(n.metadata->>'serviceSlug') = '')
             AND NOT EXISTS (${otherIdExistsSql})
           )
         )`,
      [idParams, slug],
    );
    return this.inquiryDocumentService.removeMetadataByInquiryIds(
      slug,
      ids,
      manager,
    );
  }

  private chunkIds(ids: number[]): number[][] {
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += ServiceInquiryService.BATCH_CHUNK_SIZE) {
      chunks.push(ids.slice(i, i + ServiceInquiryService.BATCH_CHUNK_SIZE));
    }
    return chunks;
  }

  async softDeleteBatch(
    ids: number[],
    deletedByUserId: number,
    serviceSlug?: string,
  ): Promise<{ deletedCount: number }> {
    if (!ids.length) return { deletedCount: 0 };

    const manager = this.repositories.shippingAgency.manager;
    const grouped = await this.queries.groupIdsBySlug(
      ids,
      { includeDeleted: false, serviceSlug },
      manager,
    );
    if (!grouped.size) {
      throw new NotFoundException('One or more inquiries were not found');
    }

    let deletedCount = 0;
    const now = new Date();
    for (const [slug, slugIds] of grouped) {
      const tableName = this.repositories.tableNameForSlug(slug);
      for (const chunk of this.chunkIds(slugIds)) {
        deletedCount += await manager.transaction(async (tx) => {
          const rows: Array<{ id: string | number }> = await tx.query(
            `UPDATE ${tableName}
             SET deleted_at = $2, deleted_by = $3
             WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL
             RETURNING id`,
            [chunk, now, deletedByUserId],
          );
          return rows.length;
        });
      }
    }

    if (deletedCount !== ids.length) {
      throw new NotFoundException('One or more inquiries were not found');
    }
    return { deletedCount };
  }

  async softDeleteBatchByUser(
    userId: number,
    ids: number[],
    serviceSlug: string,
  ): Promise<{ deletedCount: number }> {
    if (!ids.length) return { deletedCount: 0 };

    const manager = this.repositories.shippingAgency.manager;
    const owned = await this.queries.allOwnedByUser(
      ids,
      userId,
      serviceSlug,
      manager,
    );
    if (!owned) {
      throw new ForbiddenException('You can only delete your own inquiries');
    }

    const tableName = this.repositories.tableNameForSlug(serviceSlug);
    let deletedCount = 0;
    const now = new Date();
    for (const chunk of this.chunkIds(ids)) {
      deletedCount += await manager.transaction(async (tx) => {
        const rows: Array<{ id: string | number }> = await tx.query(
          `UPDATE ${tableName}
           SET deleted_at = $2, deleted_by = $3
           WHERE id = ANY($1::bigint[])
             AND deleted_at IS NULL
             AND user_id = $4
           RETURNING id`,
          [chunk, now, userId, userId],
        );
        return rows.length;
      });
    }

    if (deletedCount !== ids.length) {
      throw new ForbiddenException('You can only delete your own inquiries');
    }
    return { deletedCount };
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
          const { row, slug } = await this.queries.requireWithRepository(
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
          const tableName = this.repositories.tableNameForSlug(slug);
          await manager.query(
            `DELETE FROM ${tableName} WHERE id = ANY($1::bigint[])`,
            [[String(row.id)]],
          );
          return storedObjectIds;
        },
      );
    await this.inquiryDocumentService.deleteStoredObjectsBestEffort(publicIds);
  }

  async hardDeleteBatchByAdmin(
    ids: number[],
    serviceSlug?: string,
  ): Promise<{ deletedCount: number }> {
    const normalizedIds = [
      ...new Set(
        ids
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
    if (!normalizedIds.length) return { deletedCount: 0 };

    const manager = this.repositories.shippingAgency.manager;
    const grouped = await this.queries.groupIdsBySlug(
      normalizedIds,
      { includeDeleted: true, serviceSlug },
      manager,
    );
    if (!grouped.size) {
      const hint = serviceSlug?.trim()
        ? ` for service "${serviceSlug.trim()}"`
        : '';
      throw new NotFoundException(
        `One or more inquiries were not found${hint}: ${normalizedIds.slice(0, 20).join(', ')}`,
      );
    }

    const publicIds: string[] = [];
    let deletedCount = 0;
    for (const [slug, slugIds] of grouped) {
      const tableName = this.repositories.tableNameForSlug(slug);
      for (const chunk of this.chunkIds(slugIds)) {
        const chunkPublicIds = await manager.transaction(async (tx) => {
          const stored = await this.deleteInquiryChildren(slug, chunk, tx);
          const rows: Array<{ id: string | number }> = await tx.query(
            `DELETE FROM ${tableName}
             WHERE id = ANY($1::bigint[])
             RETURNING id`,
            [chunk.map(String)],
          );
          if (rows.length !== chunk.length) {
            throw new NotFoundException(
              'One or more inquiries were not found during permanent delete',
            );
          }
          deletedCount += rows.length;
          return stored;
        });
        publicIds.push(...chunkPublicIds);
      }
    }

    if (deletedCount !== normalizedIds.length) {
      throw new NotFoundException('One or more inquiries were not found');
    }

    await this.inquiryDocumentService.deleteStoredObjectsBestEffort(publicIds);
    return { deletedCount };
  }

  async restoreBatchByAdmin(
    ids: number[],
    serviceSlug?: string,
  ): Promise<{ restoredCount: number }> {
    if (!ids.length) return { restoredCount: 0 };

    const manager = this.repositories.shippingAgency.manager;
    const grouped = await this.queries.groupIdsBySlug(
      ids,
      { includeDeleted: true, serviceSlug },
      manager,
    );
    if (!grouped.size) {
      throw new NotFoundException('One or more inquiries were not found');
    }

    let restoredCount = 0;
    for (const [slug, slugIds] of grouped) {
      const tableName = this.repositories.tableNameForSlug(slug);
      for (const chunk of this.chunkIds(slugIds)) {
        restoredCount += await manager.transaction(async (tx) => {
          const rows: Array<{ id: string | number }> = await tx.query(
            `UPDATE ${tableName}
             SET deleted_at = NULL, deleted_by = NULL
             WHERE id = ANY($1::bigint[])
             RETURNING id`,
            [chunk],
          );
          return rows.length;
        });
      }
    }

    if (restoredCount !== ids.length) {
      throw new NotFoundException('One or more inquiries were not found');
    }
    return { restoredCount };
  }

  async restoreByServiceAndId(
    serviceTypeName: string,
    id: number,
  ): Promise<void> {
    const slug = this.repositories.toSlug(serviceTypeName);
    const tableName = this.repositories.tableNameForSlug(slug);
    await this.repositories.shippingAgency.manager.transaction(
      async (manager) => {
        const rows: Array<{ id: string | number }> = await manager.query(
          `UPDATE ${tableName}
           SET deleted_at = NULL, deleted_by = NULL
           WHERE id = ANY($1::bigint[])
           RETURNING id`,
          [[id]],
        );
        if (!rows.length) {
          throw new NotFoundException('Inquiry not found');
        }
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
}
