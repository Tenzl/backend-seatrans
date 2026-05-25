import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { ServiceInquiry } from '../entities/service-inquiry.entity';
import { ServiceType } from '../../logistics/entities/service-type.entity';
import { User } from '../../auth/entities/user.entity';
import { PublicInquiryRequestDto } from '../dto/public-inquiry-request.dto';
import { InquiryStatus } from '../enums/inquiry-status.enum';
import { ListInquiriesQueryDto } from '../dto/list-inquiries-query.dto';
import { UpdateInquiryStatusDto } from '../dto/update-inquiry-status.dto';
import { UpdateInquiryFormDto } from '../dto/update-inquiry-form.dto';
import { UpdateInquiryHoursDto } from '../dto/update-inquiry-hours.dto';
import { InquiryDocumentService } from './inquiry-document.service';

@Injectable()
export class ServiceInquiryService {
  private static readonly SERVICE_SHIPPING_AGENCY = 'SHIPPING AGENCY';
  private static readonly SERVICE_CHARTERING = 'CHARTERING';
  private static readonly SERVICE_FREIGHT_FORWARDING = 'FREIGHT FORWARDING';
  private static readonly SERVICE_LOGISTICS = 'LOGISTICS';
  private static readonly SERVICE_SPECIAL_REQUEST = 'SPECIAL REQUEST';

  private static readonly DEFAULT_PAGE_SIZE = 20;
  private static readonly MAX_PAGE_SIZE = 100;

  constructor(
    @InjectRepository(ServiceInquiry)
    private readonly inquiryRepository: Repository<ServiceInquiry>,
    @InjectRepository(ServiceType)
    private readonly serviceTypeRepository: Repository<ServiceType>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly inquiryDocumentService: InquiryDocumentService,
  ) {}

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

    const row = this.inquiryRepository.create({
      serviceType,
      user: currentUser,
      fullName: this.trimToNull(dto.fullName) ?? currentUser.fullName,
      email: this.trimToNull(dto.email) ?? currentUser.email,
      phone: this.trimToNull(dto.phone) ?? currentUser.phone,
      company: this.trimToNull(dto.company) ?? currentUser.company,
      status: InquiryStatus.PENDING,
      notes: this.trimToNull(dto.notes),
      quoteForm: this.isShippingAgency(serviceType.name) ? 'HCM' : null,
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
      loadingPort: this.trimToNull(dto.loadingPort),
      dischargingPort: this.trimToNull(dto.dischargingPort),
      laycanFrom: this.toDateOnly(dto.laycanFrom),
      laycanTo: this.toDateOnly(dto.laycanTo),
      deliveryTerm: this.trimToNull(dto.deliveryTerm),
      container20ft: dto.container20 ?? null,
      container40ft: dto.container40 ?? null,
      shipmentFrom: this.toDateOnly(dto.shipmentFrom),
      shipmentTo: this.toDateOnly(dto.shipmentTo),
      subject: this.trimToNull(dto.subject),
      message: this.trimToNull(dto.message),
      transportLs: this.trimToNull(dto.transportLs),
      transportQuarantine: this.trimToNull(dto.transportQuarantine),
      dischargeLoadingLocation: this.trimToNull(dto.dischargeLoadingLocation),
      boatHireAmount: this.toNumericString(dto.boatHireAmount),
      tallyFeeAmount: this.toNumericString(dto.tallyFeeAmount),
      details: dto.details ?? null,
    });

    const saved = await this.inquiryRepository.save(row);

    if (files.length) {
      try {
        await this.inquiryDocumentService.saveAttachmentsForInquiry(saved, files, currentUserId);
      } catch {
        // Do not fail inquiry submission if attachment persistence fails.
      }
    }

    return {
      message: 'Inquiry submitted successfully.',
      serviceSlug: this.toServiceSlug(serviceType.name),
      targetId: saved.id,
    };
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
        serviceTypeId: serviceType?.id,
      },
      query,
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
        serviceTypeId: serviceType?.id,
      },
      query,
    );
  }

  async getByServiceAndId(serviceTypeName: string, id: number): Promise<unknown> {
    const serviceType = await this.resolveServiceTypeByAnyName(serviceTypeName);
    const row = await this.inquiryRepository.findOne({
      where: {
        id,
        serviceType: { id: serviceType.id },
      },
      relations: {
        serviceType: true,
        user: true,
      },
    });

    if (!row) {
      throw new NotFoundException('Inquiry not found');
    }

    return this.toResponse(row);
  }

  async updateStatus(
    serviceTypeName: string,
    id: number,
    dto: UpdateInquiryStatusDto,
  ): Promise<unknown> {
    const row = await this.requireByServiceAndId(serviceTypeName, id);
    row.status = dto.status;

    const saved = await this.inquiryRepository.save(row);
    return this.toResponse(saved);
  }

  async updateForm(
    serviceTypeName: string,
    id: number,
    dto: UpdateInquiryFormDto,
  ): Promise<unknown> {
    const row = await this.requireByServiceAndId(serviceTypeName, id);
    if (!this.isShippingAgency(row.serviceType.name)) {
      throw new BadRequestException('Quote form update only supported for shipping agency');
    }

    row.quoteForm = dto.form.trim().toUpperCase();
    const saved = await this.inquiryRepository.save(row);
    return this.toResponse(saved);
  }

  async updateHours(
    serviceTypeName: string,
    id: number,
    dto: UpdateInquiryHoursDto,
  ): Promise<unknown> {
    const row = await this.requireByServiceAndId(serviceTypeName, id);
    if (!this.isShippingAgency(row.serviceType.name)) {
      throw new BadRequestException('Hours update only supported for shipping agency');
    }

    if (dto.berthHours != null) {
      row.berthHours = this.toNumericString(dto.berthHours);
    }
    if (dto.anchorageHours != null) {
      row.anchorageHours = this.toNumericString(dto.anchorageHours);
    }
    if (dto.pilotage3rdMiles != null) {
      row.pilotage3rdMiles = this.toNumericString(dto.pilotage3rdMiles);
    }

    const saved = await this.inquiryRepository.save(row);
    return this.toResponse(saved);
  }

  async deleteByServiceAndId(serviceTypeName: string, id: number): Promise<void> {
    const row = await this.requireByServiceAndId(serviceTypeName, id);

    await this.inquiryDocumentService.hardDeleteByInquiry(row.id);
    await this.inquiryRepository.remove(row);
  }

  async deleteBatchByUser(userId: number, ids: number[]): Promise<{ deletedCount: number }> {
    const rows = await this.inquiryRepository.find({
      where: {
        id: In(ids),
      },
      relations: {
        user: true,
      },
    });

    const ownedRows = rows.filter((row) => row.user.id === userId);
    if (ownedRows.length !== ids.length) {
      throw new ForbiddenException('You can only delete your own inquiries');
    }

    for (const row of ownedRows) {
      await this.inquiryDocumentService.hardDeleteByInquiry(row.id);
      await this.inquiryRepository.remove(row);
    }

    return { deletedCount: ownedRows.length };
  }

  async deleteBatchByAdmin(ids: number[]): Promise<{ deletedCount: number }> {
    const rows = await this.inquiryRepository.find({
      where: { id: In(ids) },
    });

    for (const row of rows) {
      await this.inquiryDocumentService.hardDeleteByInquiry(row.id);
      await this.inquiryRepository.remove(row);
    }

    return { deletedCount: rows.length };
  }

  private async listInquiries(
    filters: {
      user?: { id: number };
      status?: InquiryStatus;
      serviceTypeId?: number;
    },
    query: ListInquiriesQueryDto,
  ): Promise<{ content: unknown[]; totalElements: number; totalPages: number; size: number; number: number }> {
    const page = this.sanitizePage(query.page);
    const size = this.sanitizePageSize(query.size);

    const where: FindOptionsWhere<ServiceInquiry> = {};

    if (filters.user) {
      where.user = { id: filters.user.id } as User;
    }
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.serviceTypeId) {
      where.serviceType = { id: filters.serviceTypeId } as ServiceType;
    }

    const [rows, totalElements] = await this.inquiryRepository.findAndCount({
      where,
      relations: {
        serviceType: true,
        user: true,
      },
      order: { submittedAt: 'DESC' },
      skip: page * size,
      take: size,
    });

    return {
      content: rows.map((row) => this.toResponse(row)),
      totalElements,
      totalPages: totalElements === 0 ? 0 : Math.ceil(totalElements / size),
      size,
      number: page,
    };
  }

  private toResponse(row: ServiceInquiry): Record<string, unknown> {
    const base = {
      id: row.id,
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      company: row.company,
      notes: row.notes,
      status: row.status,
      quoteForm: row.quoteForm,
      serviceType: {
        id: row.serviceType.id,
        name: row.serviceType.name,
        displayName: row.serviceType.displayName,
      },
      submittedAt: row.submittedAt,
      updatedAt: row.updatedAt,
    };

    const serviceSlug = this.toServiceSlug(row.serviceType.name);
    if (serviceSlug === 'shipping-agency') {
      return {
        ...base,
        toName: row.toName,
        mv: row.mv,
        eta: row.eta,
        dwt: row.dwt,
        grt: row.grt,
        loa: row.loa,
        cargoType: row.cargoType,
        cargoName: row.cargoName,
        cargoNameOther: row.cargoNameOther,
        cargoQuantity: row.cargoQuantity,
        portOfCall: row.portOfCall,
        dischargeLoadingLocation: row.dischargeLoadingLocation,
        otherInfo: row.otherInfo,
        transportLs: row.transportLs,
        transportQuarantine: row.transportQuarantine,
        frtTaxType: row.frtTaxType,
        purposeOfCalling: row.purposeOfCalling,
        boatHireAmount: row.boatHireAmount,
        tallyFeeAmount: row.tallyFeeAmount,
        quoteForm: row.quoteForm,
        berthHours: row.berthHours,
        anchorageHours: row.anchorageHours,
        pilotage3rdMiles: row.pilotage3rdMiles,
      };
    }

    if (serviceSlug === 'chartering') {
      return {
        ...base,
        cargoQuantity: row.cargoQuantity,
        loadingPort: row.loadingPort,
        dischargingPort: row.dischargingPort,
        laycanFrom: row.laycanFrom,
        laycanTo: row.laycanTo,
        otherInfo: row.otherInfo,
      };
    }

    if (serviceSlug === 'freight-forwarding' || serviceSlug === 'total-logistic') {
      return {
        ...base,
        cargoName: row.cargoName,
        deliveryTerm: row.deliveryTerm,
        container20: row.container20ft,
        container40: row.container40ft,
        loadingPort: row.loadingPort,
        dischargingPort: row.dischargingPort,
        shipmentFrom: row.shipmentFrom,
        shipmentTo: row.shipmentTo,
      };
    }

    if (serviceSlug === 'special-request') {
      return {
        ...base,
        subject: row.subject,
        preferredProvinceId: row.preferredProvinceId,
        relatedDepartmentId: row.relatedDepartmentId,
        message: row.message,
        otherInfo: row.otherInfo,
      };
    }

    return base;
  }

  private async requireByServiceAndId(
    serviceTypeName: string,
    id: number,
  ): Promise<ServiceInquiry> {
    const serviceType = await this.resolveServiceTypeByAnyName(serviceTypeName);
    const row = await this.inquiryRepository.findOne({
      where: {
        id,
        serviceType: { id: serviceType.id },
      },
      relations: {
        serviceType: true,
        user: true,
      },
    });

    if (!row) {
      throw new NotFoundException('Inquiry not found');
    }

    return row;
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
}
