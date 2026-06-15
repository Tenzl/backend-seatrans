import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
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
import { ListInquiriesQueryDto } from '../dto/list-inquiries-query.dto';
import { UpdateInquiryStatusDto } from '../dto/update-inquiry-status.dto';
import { UpdateInquiryFormDto } from '../dto/update-inquiry-form.dto';
import { UpdateInquiryHoursDto } from '../dto/update-inquiry-hours.dto';
import { InquiryDocumentService } from './inquiry-document.service';
import { InquiryCreatedSource } from '../enums/inquiry-created-source.enum';
import {
  InquiryResponseAudience,
  mapShippingAgencyInquiryFields,
} from '../mappers/shipping-agency-inquiry.mapper';
import { NotificationService } from '../../notification/notification.service';
import { buildCustomerSubmittedSnapshot } from '../utils/customer-submitted-snapshot.util';

@Injectable()
export class ServiceInquiryService {
  private static readonly SERVICE_SHIPPING_AGENCY = 'SHIPPING AGENCY';
  private static readonly SERVICE_CHARTERING = 'CHARTERING';
  private static readonly SERVICE_FREIGHT_FORWARDING = 'FREIGHT FORWARDING';
  private static readonly SERVICE_LOGISTICS = 'LOGISTICS';
  private static readonly SERVICE_SPECIAL_REQUEST = 'SPECIAL REQUEST';

  private static readonly DEFAULT_PAGE_SIZE = 20;
  private static readonly MAX_PAGE_SIZE = 100;

  /** Normalized service slug → per-service inquiry repository. */
  private readonly repos: Record<string, Repository<BaseInquiry>>;

  constructor(
    @InjectRepository(ShippingAgencyInquiryEntity)
    private readonly shippingAgencyRepo: Repository<ShippingAgencyInquiryEntity>,
    @InjectRepository(CharteringBrokerageInquiryEntity)
    private readonly charteringRepo: Repository<CharteringBrokerageInquiryEntity>,
    @InjectRepository(FreightForwardingInquiryEntity)
    private readonly freightRepo: Repository<FreightForwardingInquiryEntity>,
    @InjectRepository(TotalLogisticsInquiryEntity)
    private readonly totalLogisticsRepo: Repository<TotalLogisticsInquiryEntity>,
    @InjectRepository(SpecialRequestInquiryEntity)
    private readonly specialRequestRepo: Repository<SpecialRequestInquiryEntity>,
    @InjectRepository(InquiryFieldChangeLog)
    private readonly fieldChangeLogRepository: Repository<InquiryFieldChangeLog>,
    @InjectRepository(ServiceType)
    private readonly serviceTypeRepository: Repository<ServiceType>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly inquiryDocumentService: InquiryDocumentService,
    private readonly notificationService: NotificationService,
  ) {
    this.repos = {
      'shipping-agency': shippingAgencyRepo as unknown as Repository<BaseInquiry>,
      chartering: charteringRepo as unknown as Repository<BaseInquiry>,
      'freight-forwarding': freightRepo as unknown as Repository<BaseInquiry>,
      'total-logistic': totalLogisticsRepo as unknown as Repository<BaseInquiry>,
      'special-request': specialRequestRepo as unknown as Repository<BaseInquiry>,
    };
  }

  async submitInquiry(
    dto: PublicInquiryRequestDto,
    files: Express.Multer.File[],
    currentUserId: number,
  ): Promise<{ message: string; serviceSlug: string; targetId: number }> {
    const currentUser = await this.userRepository.findOne({ where: { id: currentUserId } });
    if (!currentUser) {
      throw new BadRequestException('User not found. Please log in again.');
    }

    if (!currentUser.fullName?.trim() || !currentUser.email?.trim()) {
      throw new BadRequestException('Please complete your profile before submitting an inquiry.');
    }

    const serviceType = await this.resolveServiceType(dto.serviceTypeId, dto.serviceTypeSlug);
    const slug = this.toServiceSlug(serviceType.name);
    const code = await this.generateCodeForService(serviceType.name);

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
      code,
    };

    const saved = await this.createForSlug(slug, common, dto);

    await this.notificationService.notifyInternalNewInquiry(saved);

    if (files.length) {
      try {
        await this.inquiryDocumentService.saveAttachmentsForInquiry(saved, files, currentUserId);
      } catch {
        // Do not fail inquiry submission if attachment persistence fails.
      }
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
  ): Promise<BaseInquiry> {
    switch (slug) {
      case 'shipping-agency': {
        const row = this.shippingAgencyRepo.create({
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
          cargoQuantity: this.trimToNull(dto.cargoQuantity) ?? this.toNumericString(dto.quantityTons),
          frtTaxType: this.trimToNull(dto.frtTaxType),
          purposeOfCalling: this.trimToNull(dto.purposeOfCalling),
          portOfCall: this.trimToNull(dto.portOfCall),
          dischargeLoadingLocation: this.trimToNull(dto.dischargeLoadingLocation),
          boatHireAmount: this.toNumericString(dto.boatHireAmount),
          tallyFeeAmount: this.toNumericString(dto.tallyFeeAmount),
          transportLs: this.trimToNull(dto.transportLs),
          transportQuarantine: this.trimToNull(dto.transportQuarantine),
        } as Partial<ShippingAgencyInquiryEntity>);
        row.customerSubmittedSnapshot = buildCustomerSubmittedSnapshot(row);
        return this.shippingAgencyRepo.save(row);
      }
      case 'chartering': {
        const row = this.charteringRepo.create({
          ...common,
          cargoQuantity: this.trimToNull(dto.cargoQuantity) ?? this.toNumericString(dto.quantityTons),
          loadingPort: this.trimToNull(dto.loadingPort),
          dischargingPort: this.trimToNull(dto.dischargingPort),
          laycanFrom: this.toDateOnly(dto.laycanFrom),
          laycanTo: this.toDateOnly(dto.laycanTo),
        } as Partial<CharteringBrokerageInquiryEntity>);
        return this.charteringRepo.save(row);
      }
      case 'freight-forwarding': {
        const row = this.freightRepo.create({
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
        return this.freightRepo.save(row);
      }
      case 'total-logistic': {
        const row = this.totalLogisticsRepo.create({
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
        return this.totalLogisticsRepo.save(row);
      }
      case 'special-request': {
        const row = this.specialRequestRepo.create({
          ...common,
          subject: this.trimToNull(dto.subject),
          message: this.trimToNull(dto.message),
          preferredProvinceId: dto.preferredProvinceId ?? null,
          relatedDepartmentId: dto.relatedDepartmentId ?? null,
        } as Partial<SpecialRequestInquiryEntity>);
        return this.specialRequestRepo.save(row);
      }
      default:
        throw new BadRequestException(`Unsupported service type: ${slug}`);
    }
  }

  async listByUser(
    userId: number,
    query: ListInquiriesQueryDto,
  ): Promise<{ content: unknown[]; totalElements: number; totalPages: number; size: number; number: number }> {
    const serviceTypeFilter =
      query.serviceType?.trim() || query.serviceSlug?.trim();
    const serviceType = await this.resolveServiceTypeFromFilter(serviceTypeFilter);
    return this.listInquiries(
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
  ): Promise<{ content: unknown[]; totalElements: number; totalPages: number; size: number; number: number }> {
    const serviceTypeFilter =
      query.serviceType?.trim() || query.serviceSlug?.trim();
    const serviceType = await this.resolveServiceTypeFromFilter(serviceTypeFilter);
    return this.listInquiries(
      {
        status: query.status,
        serviceType: serviceType ?? undefined,
      },
      query,
      'admin',
    );
  }

  async getByServiceAndId(serviceTypeName: string, id: number): Promise<unknown> {
    const row = await this.requireByServiceAndId(serviceTypeName, id);
    return this.toResponse(row, 'admin');
  }

  async updateStatus(
    serviceTypeName: string,
    id: number,
    dto: UpdateInquiryStatusDto,
  ): Promise<unknown> {
    const { row, repo } = await this.requireRowWithRepo(serviceTypeName, id);
    const previousStatus = row.status;
    row.status = dto.status;

    const saved = await repo.save(row);
    await this.notificationService.notifyStatusChanged(saved, previousStatus);
    await this.notificationService.notifyInquiryQuotedIfNeeded(saved, previousStatus);
    return this.toResponse(saved, 'admin');
  }

  async updateForm(
    serviceTypeName: string,
    id: number,
    dto: UpdateInquiryFormDto,
  ): Promise<unknown> {
    if (!this.isShippingAgency(serviceTypeName)) {
      throw new BadRequestException('Quote form update only supported for shipping agency');
    }
    const row = await this.requireShippingAgencyRow(id);
    row.quoteForm = dto.form.trim().toUpperCase();
    const saved = await this.shippingAgencyRepo.save(row);
    return this.toResponse(saved, 'admin');
  }

  async updateHours(
    serviceTypeName: string,
    id: number,
    dto: UpdateInquiryHoursDto,
  ): Promise<unknown> {
    if (!this.isShippingAgency(serviceTypeName)) {
      throw new BadRequestException('Hours update only supported for shipping agency');
    }
    const row = await this.requireShippingAgencyRow(id);

    if (dto.berthHours != null) {
      row.berthHours = this.toNumericString(dto.berthHours);
    }
    if (dto.anchorageHours != null) {
      row.anchorageHours = this.toNumericString(dto.anchorageHours);
    }
    if (dto.pilotage3rdMiles != null) {
      row.pilotage3rdMiles = this.toNumericString(dto.pilotage3rdMiles);
    }

    const saved = await this.shippingAgencyRepo.save(row);
    return this.toResponse(saved, 'admin');
  }

  /**
   * Remove every child row that references an inquiry so it can be deleted
   * cleanly. Field-change logs only exist for shipping agency; documents are
   * keyed by the (globally-unique) inquiry id.
   */
  private async deleteInquiryChildren(slug: string, inquiryId: number): Promise<void> {
    if (slug === 'shipping-agency') {
      await this.fieldChangeLogRepository.delete({ inquiryId });
    }
    await this.inquiryDocumentService.hardDeleteByInquiry(inquiryId);
  }

  async deleteByServiceAndId(serviceTypeName: string, id: number): Promise<void> {
    const { row, repo, slug } = await this.requireRowWithRepo(serviceTypeName, id);
    await this.deleteInquiryChildren(slug, row.id);
    await repo.remove(row);
  }

  async deleteBatchByUser(userId: number, ids: number[]): Promise<{ deletedCount: number }> {
    const found = await this.findRowsAcrossRepos(ids);

    if (found.length !== ids.length || found.some((f) => f.row.userId !== userId)) {
      throw new ForbiddenException('You can only delete your own inquiries');
    }

    for (const { row, repo, slug } of found) {
      await this.deleteInquiryChildren(slug, row.id);
      await repo.remove(row);
    }

    return { deletedCount: found.length };
  }

  async deleteBatchByAdmin(ids: number[]): Promise<{ deletedCount: number }> {
    const found = await this.findRowsAcrossRepos(ids);

    for (const { row, repo, slug } of found) {
      await this.deleteInquiryChildren(slug, row.id);
      await repo.remove(row);
    }

    return { deletedCount: found.length };
  }

  private async listInquiries(
    filters: {
      user?: { id: number };
      status?: InquiryStatus;
      serviceType?: ServiceType;
    },
    query: ListInquiriesQueryDto,
    audience: InquiryResponseAudience = 'admin',
  ): Promise<{ content: unknown[]; totalElements: number; totalPages: number; size: number; number: number }> {
    const page = this.sanitizePage(query.page);
    const size = this.sanitizePageSize(query.size);

    const where: FindOptionsWhere<BaseInquiry> = {};
    if (filters.user) {
      where.user = { id: filters.user.id } as User;
    }
    if (filters.status) {
      where.status = filters.status;
    }

    // Filtered by a single service type → query just that table (true DB paging).
    if (filters.serviceType) {
      const repo = this.repoForSlug(this.toServiceSlug(filters.serviceType.name));
      const [rows, totalElements] = await repo.findAndCount({
        where,
        relations: { serviceType: true, user: true },
        order: { submittedAt: 'DESC' },
        skip: page * size,
        take: size,
      });
      return {
        content: rows.map((row) => this.toResponse(row, audience)),
        totalElements,
        totalPages: totalElements === 0 ? 0 : Math.ceil(totalElements / size),
        size,
        number: page,
      };
    }

    // No service filter → paginate across all tables at the DB level (UNION ALL),
    // then hydrate only the rows on the requested page.
    return this.listAcrossAllRepos(
      { user: filters.user, status: filters.status },
      page,
      size,
      audience,
    );
  }

  /**
   * Cross-table listing with real database pagination. A UNION ALL over the
   * five inquiry tables determines the ordered page of (id, slug); only those
   * rows are then hydrated with relations. Table names and slugs are fixed
   * constants (never user input); the user/status filters are parameterized.
   */
  private async listAcrossAllRepos(
    filters: { user?: { id: number }; status?: InquiryStatus },
    page: number,
    size: number,
    audience: InquiryResponseAudience,
  ): Promise<{ content: unknown[]; totalElements: number; totalPages: number; size: number; number: number }> {
    const sources: Array<[string, string]> = [
      ['shipping_agency_inquiries', 'shipping-agency'],
      ['chartering_broking_inquiries', 'chartering'],
      ['freight_forwarding_inquiries', 'freight-forwarding'],
      ['total_logistics_inquiries', 'total-logistic'],
      ['special_request_inquiries', 'special-request'],
    ];
    const union = sources
      .map(
        ([table, slug]) =>
          `SELECT id, submitted_at, user_id, status, '${slug}'::text AS slug FROM ${table}`,
      )
      .join(' UNION ALL ');

    const params: unknown[] = [];
    const conds: string[] = [];
    if (filters.user) {
      params.push(filters.user.id);
      conds.push(`user_id = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      conds.push(`status = $${params.length}`);
    }
    const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const manager = this.shippingAgencyRepo.manager;

    const countRows: Array<{ total: number }> = await manager.query(
      `SELECT COUNT(*)::int AS total FROM (${union}) AS t ${whereSql}`,
      params,
    );
    const totalElements = countRows[0]?.total ?? 0;

    if (totalElements === 0) {
      return { content: [], totalElements: 0, totalPages: 0, size, number: page };
    }

    params.push(size);
    const limitIdx = params.length;
    params.push(page * size);
    const offsetIdx = params.length;

    const pageRows: Array<{ id: string | number; slug: string }> = await manager.query(
      `SELECT id, slug FROM (${union}) AS t ${whereSql} ` +
        `ORDER BY submitted_at DESC, id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    // Hydrate only the page's rows, grouped by table.
    const idsBySlug = new Map<string, number[]>();
    for (const { id, slug } of pageRows) {
      const list = idsBySlug.get(slug) ?? [];
      list.push(Number(id));
      idsBySlug.set(slug, list);
    }

    const rowByKey = new Map<string, BaseInquiry>();
    for (const [slug, ids] of idsBySlug) {
      const repo = this.repos[slug];
      const rows = await repo.find({
        where: ids.map((id) => ({ id }) as FindOptionsWhere<BaseInquiry>),
        relations: { serviceType: true, user: true },
      });
      for (const row of rows) {
        rowByKey.set(`${slug}:${row.id}`, row);
      }
    }

    const content = pageRows
      .map(({ id, slug }) => rowByKey.get(`${slug}:${Number(id)}`))
      .filter((row): row is BaseInquiry => row != null)
      .map((row) => this.toResponse(row, audience));

    return {
      content,
      totalElements,
      totalPages: Math.ceil(totalElements / size),
      size,
      number: page,
    };
  }

  private toResponse(
    row: BaseInquiry,
    audience: InquiryResponseAudience = 'admin',
  ): Record<string, unknown> {
    const serviceSlug = this.toServiceSlug(row.serviceType.name);
    const base = {
      id: row.id,
      code: row.code,
      userId: row.userId,
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      company: row.company,
      notes: row.notes,
      status: row.status,
      serviceType: {
        id: row.serviceType.id,
        name: row.serviceType.name,
        displayName: row.serviceType.displayName,
      },
      submittedAt: row.submittedAt,
      updatedAt: row.updatedAt,
    };

    if (serviceSlug === 'shipping-agency') {
      return {
        ...base,
        ...mapShippingAgencyInquiryFields(row as ShippingAgencyInquiryEntity, audience),
      };
    }

    if (serviceSlug === 'chartering') {
      const r = row as CharteringBrokerageInquiryEntity;
      return {
        ...base,
        cargoQuantity: r.cargoQuantity,
        loadingPort: r.loadingPort,
        dischargingPort: r.dischargingPort,
        laycanFrom: r.laycanFrom,
        laycanTo: r.laycanTo,
        otherInfo: r.otherInfo,
      };
    }

    if (serviceSlug === 'freight-forwarding' || serviceSlug === 'total-logistic') {
      const r = row as FreightForwardingInquiryEntity;
      return {
        ...base,
        cargoName: r.cargoName,
        deliveryTerm: r.deliveryTerm,
        container20: r.container20ft,
        container40: r.container40ft,
        loadingPort: r.loadingPort,
        dischargingPort: r.dischargingPort,
        shipmentFrom: r.shipmentFrom,
        shipmentTo: r.shipmentTo,
      };
    }

    if (serviceSlug === 'special-request') {
      const r = row as SpecialRequestInquiryEntity;
      return {
        ...base,
        subject: r.subject,
        preferredProvinceId: r.preferredProvinceId,
        relatedDepartmentId: r.relatedDepartmentId,
        message: r.message,
        otherInfo: r.otherInfo,
      };
    }

    return base;
  }

  private async requireByServiceAndId(
    serviceTypeName: string,
    id: number,
  ): Promise<BaseInquiry> {
    return (await this.requireRowWithRepo(serviceTypeName, id)).row;
  }

  private async requireRowWithRepo(
    serviceTypeName: string,
    id: number,
  ): Promise<{ row: BaseInquiry; repo: Repository<BaseInquiry>; slug: string }> {
    const slug = this.toServiceSlug(serviceTypeName);
    const repo = this.repoForSlug(slug);
    const row = await repo.findOne({
      where: { id },
      relations: { serviceType: true, user: true },
    });

    if (!row) {
      throw new NotFoundException('Inquiry not found');
    }

    return { row, repo, slug };
  }

  private async requireShippingAgencyRow(id: number): Promise<ShippingAgencyInquiryEntity> {
    const row = await this.shippingAgencyRepo.findOne({
      where: { id },
      relations: { serviceType: true, user: true },
    });
    if (!row) {
      throw new NotFoundException('Inquiry not found');
    }
    return row;
  }

  private async findRowsAcrossRepos(
    ids: number[],
  ): Promise<Array<{ row: BaseInquiry; repo: Repository<BaseInquiry>; slug: string }>> {
    const found: Array<{ row: BaseInquiry; repo: Repository<BaseInquiry>; slug: string }> = [];
    if (!ids.length) return found;

    for (const [slug, repo] of Object.entries(this.repos)) {
      const rows = await repo.find({
        where: ids.map((id) => ({ id }) as FindOptionsWhere<BaseInquiry>),
        relations: { serviceType: true, user: true },
      });
      for (const row of rows) {
        found.push({ row, repo, slug });
      }
    }

    return found;
  }

  private repoForSlug(slug: string): Repository<BaseInquiry> {
    const repo = this.repos[this.toServiceSlug(slug)];
    if (!repo) {
      throw new BadRequestException(`Unsupported service type: ${slug}`);
    }
    return repo;
  }

  private async resolveServiceType(
    serviceTypeId?: number,
    serviceTypeSlug?: string,
  ): Promise<ServiceType> {
    if (serviceTypeId != null) {
      const byId = await this.serviceTypeRepository.findOne({ where: { id: serviceTypeId } });
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

  private async resolveServiceTypeFromFilter(serviceType?: string): Promise<ServiceType | null> {
    if (!serviceType?.trim()) {
      return null;
    }
    return this.resolveServiceTypeByAnyName(serviceType);
  }

  private async resolveServiceTypeByAnyName(value: string): Promise<ServiceType> {
    const normalizedName = this.toServiceName(value);

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

  private toServiceName(value: string): string {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'shipping-agency' || normalized === 'shipping agency') {
      return ServiceInquiryService.SERVICE_SHIPPING_AGENCY;
    }
    if (
      normalized === 'chartering' ||
      normalized === 'chartering-ship-broking' ||
      normalized === 'chartering-broking'
    ) {
      return ServiceInquiryService.SERVICE_CHARTERING;
    }
    if (normalized === 'freight-forwarding' || normalized === 'freight forwarding') {
      return ServiceInquiryService.SERVICE_FREIGHT_FORWARDING;
    }
    if (
      normalized === 'logistics' ||
      normalized === 'total-logistic' ||
      normalized === 'total-logistics'
    ) {
      return ServiceInquiryService.SERVICE_LOGISTICS;
    }
    if (normalized === 'special-request' || normalized === 'special request') {
      return ServiceInquiryService.SERVICE_SPECIAL_REQUEST;
    }

    return value.trim();
  }

  private toServiceSlug(serviceName: string): string {
    const normalizedName = this.toServiceName(serviceName);

    switch (normalizedName) {
      case ServiceInquiryService.SERVICE_SHIPPING_AGENCY:
        return 'shipping-agency';
      case ServiceInquiryService.SERVICE_CHARTERING:
        return 'chartering';
      case ServiceInquiryService.SERVICE_FREIGHT_FORWARDING:
        return 'freight-forwarding';
      case ServiceInquiryService.SERVICE_LOGISTICS:
        return 'total-logistic';
      case ServiceInquiryService.SERVICE_SPECIAL_REQUEST:
        return 'special-request';
      default:
        return normalizedName.toLowerCase().replace(/\s+/g, '-');
    }
  }

  private isShippingAgency(serviceName: string): boolean {
    return this.toServiceName(serviceName) === ServiceInquiryService.SERVICE_SHIPPING_AGENCY;
  }

  private sanitizePage(page?: number): number {
    if (!Number.isFinite(page) || page == null || page < 0) {
      return 0;
    }
    return page;
  }

  private sanitizePageSize(size?: number): number {
    if (!Number.isFinite(size) || size == null || size <= 0) {
      return ServiceInquiryService.DEFAULT_PAGE_SIZE;
    }
    return Math.min(size, ServiceInquiryService.MAX_PAGE_SIZE);
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

  private async generateCodeForService(serviceName: string): Promise<string> {
    const prefixes: Record<string, string> = {
      [ServiceInquiryService.SERVICE_SHIPPING_AGENCY]: 'SA',
      [ServiceInquiryService.SERVICE_CHARTERING]: 'CH',
      [ServiceInquiryService.SERVICE_FREIGHT_FORWARDING]: 'FF',
      [ServiceInquiryService.SERVICE_LOGISTICS]: 'TL',
      [ServiceInquiryService.SERVICE_SPECIAL_REQUEST]: 'SR',
    };

    const serviceKey = this.toServiceName(serviceName);
    const prefixCode = prefixes[serviceKey] ?? 'IN';
    const year = new Date().getFullYear();
    const prefix = `${prefixCode}-${year}-`;

    const repo = this.repoForSlug(this.toServiceSlug(serviceName));
    const last = await repo
      .createQueryBuilder('inquiry')
      .select('inquiry.code', 'code')
      .where('inquiry.code LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy('inquiry.code', 'DESC')
      .limit(1)
      .getRawOne<{ code: string }>();

    const nextNumber = last?.code
      ? parseInt(last.code.slice(prefix.length), 10) + 1
      : 1;

    return `${prefix}${String(nextNumber).padStart(4, '0')}`;
  }
}
