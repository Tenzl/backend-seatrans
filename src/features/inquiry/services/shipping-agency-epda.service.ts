import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';
import { ServiceType } from '../../logistics/entities/service-type.entity';
import { User } from '../../auth/entities/user.entity';
import { InquiryCreatedSource } from '../enums/inquiry-created-source.enum';
import { InquiryStatus } from '../enums/inquiry-status.enum';
import { UpdateShippingAgencyEpdaDto } from '../dto/update-shipping-agency-epda.dto';
import { IssueShippingAgencyEpdaDto } from '../dto/issue-shipping-agency-epda.dto';
import { CreateInternalShippingAgencyInquiryDto } from '../dto/create-internal-shipping-agency-inquiry.dto';
import {
  DEFAULT_GARBAGE_CBM_AMOUNT,
  getDefaultGarbageUsdRate,
} from '../constants/epda-garbage.defaults';
import {
  InquiryResponseAudience,
  mapShippingAgencyInquiryFields,
} from '../mappers/shipping-agency-inquiry.mapper';
import { NotificationService } from '../../notification/notification.service';
import {
  InquiryFieldChangeAction,
} from '../entities/inquiry-field-change-log.entity';
import { InquiryFieldChangeService } from './inquiry-field-change.service';

const MAX_SNAPSHOT_BYTES = 256 * 1024;
const SERVICE_SHIPPING_AGENCY = 'SHIPPING AGENCY';

@Injectable()
export class ShippingAgencyEpdaService {
  constructor(
    @InjectRepository(ShippingAgencyInquiryEntity)
    private readonly inquiryRepository: Repository<ShippingAgencyInquiryEntity>,
    @InjectRepository(ServiceType)
    private readonly serviceTypeRepository: Repository<ServiceType>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly notificationService: NotificationService,
    private readonly fieldChangeService: InquiryFieldChangeService,
  ) {}

  async createInternalInquiry(
    dto: CreateInternalShippingAgencyInquiryDto,
    actorUserId: number,
  ): Promise<Record<string, unknown>> {
    const serviceType = await this.requireShippingAgencyServiceType();
    const customer = await this.userRepository.findOne({
      where: { id: dto.customerUserId },
    });
    if (!customer) {
      throw new BadRequestException('Customer user not found');
    }

    const actor = await this.userRepository.findOne({ where: { id: actorUserId } });
    if (!actor) {
      throw new BadRequestException('Authenticated staff user not found');
    }

    const code = await this.generateCode();

    const row = this.inquiryRepository.create({
      serviceType,
      user: customer,
      fullName: customer.fullName,
      email: customer.email,
      phone: customer.phone,
      company: customer.company,
      // Staff-created EPDA: COMPLETED when all required fields are filled,
      // otherwise PROCESSING (a partially-filled draft).
      status: dto.isComplete ? InquiryStatus.COMPLETED : InquiryStatus.PROCESSING,
      notes: this.trimToNull(dto.notes),
      createdSource: InquiryCreatedSource.INTERNAL_EPDA,
      processedBy: actor,
      processedById: actor.id,
      code,
      quoteForm: dto.quoteForm,
      toName: dto.shipownerTo.trim(),
      mv: dto.vesselName.trim(),
      grt: this.toNumericString(dto.grt),
      dwt: this.toNumericString(dto.dwt),
      loa: this.toNumericString(dto.loa),
      eta: this.toDateOnly(dto.eta),
      cargoType: this.trimToNull(dto.cargoType),
      cargoName: this.trimToNull(dto.cargoName),
      frtTaxType: this.trimToNull(dto.frtTaxType),
      purposeOfCalling: this.trimToNull(dto.purposeOfCalling),
      portOfCall: dto.portOfCall.trim(),
      dischargeLoadingLocation: dto.dischargeLoadingLocation.trim(),
      epdaDocumentDate: this.toDateOnly(dto.epdaDocumentDate),
      shipType: this.trimToNull(dto.shipType),
      berthHours: this.toNumericString(dto.berthHours ?? 96),
      anchorageHours: this.toNumericString(dto.anchorageHours ?? 24),
      pilotage3rdMiles: this.toNumericString(
        dto.pilotage3rdMiles ?? (dto.quoteForm === 'QN' ? 5 : 47),
      ),
      oceanFrtRateUsdPerMt: this.toNumericString(dto.oceanFrtRateUsdPerMt),
      garbageCbmAmount: this.toNumericString(dto.garbageCbmAmount ?? DEFAULT_GARBAGE_CBM_AMOUNT),
      garbageUsdRate: this.toNumericString(
        dto.garbageUsdRate ?? getDefaultGarbageUsdRate(dto.quoteForm),
      ),
      quarantineCargoMode: this.trimToNull(dto.quarantineCargoMode),
      agencyFeeMode: this.trimToNull(dto.agencyFeeMode),
      agencyDiscountPercent: this.toNumericString(dto.agencyDiscountPercent),
      agencyLumpsumAmount: this.toNumericString(dto.agencyLumpsumAmount),
      epdaSnapshot: dto.epdaSnapshot ? this.validateSnapshot(dto.epdaSnapshot) : null,
    });

    const saved = await this.inquiryRepository.save(row);
    // Audit: record the initial EPDA values (previous = empty) on creation.
    await this.fieldChangeService.logFieldChanges(
      saved.id,
      actorUserId,
      InquiryFieldChangeAction.EPDA_CREATE,
      Object.entries(this.epdaFieldSnapshot(saved)).map(([field, newValue]) => ({
        field,
        previousValue: null,
        newValue,
      })),
    );
    return this.toAdminInquiryPayload(saved);
  }

  async updateEpda(
    inquiryId: number,
    dto: UpdateShippingAgencyEpdaDto,
    actorUserId: number,
  ): Promise<Record<string, unknown>> {
    const row = await this.requireShippingAgencyInquiry(inquiryId);
    const before = this.epdaFieldSnapshot(row);
    this.applyCustomerVisibleUpdates(row, dto);

    if (dto.quoteForm != null) {
      row.quoteForm = dto.quoteForm;
      if (dto.garbageUsdRate === undefined && (row.garbageUsdRate == null || row.garbageUsdRate === '')) {
        row.garbageUsdRate = this.toNumericString(getDefaultGarbageUsdRate(dto.quoteForm));
      }
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
    if (dto.epdaDocumentDate !== undefined) {
      row.epdaDocumentDate = this.toDateOnly(dto.epdaDocumentDate);
    }
    if (dto.shipType !== undefined) {
      row.shipType = this.trimToNull(dto.shipType);
    }
    if (dto.oceanFrtRateUsdPerMt !== undefined) {
      row.oceanFrtRateUsdPerMt = this.toNumericString(dto.oceanFrtRateUsdPerMt);
    }
    if (dto.garbageCbmAmount !== undefined) {
      row.garbageCbmAmount = this.toNumericString(dto.garbageCbmAmount);
    }
    if (dto.garbageUsdRate !== undefined) {
      row.garbageUsdRate = this.toNumericString(dto.garbageUsdRate);
    }
    if (dto.quarantineCargoMode !== undefined) {
      row.quarantineCargoMode = this.trimToNull(dto.quarantineCargoMode);
    }
    if (dto.agencyFeeMode !== undefined) {
      row.agencyFeeMode = this.trimToNull(dto.agencyFeeMode);
    }
    if (dto.agencyDiscountPercent !== undefined) {
      row.agencyDiscountPercent = this.toNumericString(dto.agencyDiscountPercent);
    }
    if (dto.agencyLumpsumAmount !== undefined) {
      row.agencyLumpsumAmount = this.toNumericString(dto.agencyLumpsumAmount);
    }
    if (dto.epdaSnapshot !== undefined) {
      row.epdaSnapshot = dto.epdaSnapshot ? this.validateSnapshot(dto.epdaSnapshot) : null;
    }

    // Draft completeness drives the status: COMPLETED when all required fields
    // are filled, PROCESSING otherwise. Issuing to the customer (separate call)
    // is what moves it to QUOTED.
    if (dto.isComplete !== undefined) {
      row.status = dto.isComplete
        ? InquiryStatus.COMPLETED
        : InquiryStatus.PROCESSING;
    }

    await this.touchProcessedBy(row, actorUserId);
    const saved = await this.inquiryRepository.save(row);
    // Audit: log every changed EPDA field (full diff, all records).
    await this.fieldChangeService.logFieldChanges(
      saved.id,
      actorUserId,
      InquiryFieldChangeAction.EPDA_SAVE_DRAFT,
      this.diffSnapshots(before, this.epdaFieldSnapshot(saved)),
    );

    const changedFields = (dto.confirmedCustomerFieldChanges ?? [])
      .filter((c) => c.previousValue !== c.newValue)
      .map((c) => c.field);
    await this.notificationService.notifyCustomerFieldChanges(saved, changedFields);

    return this.toAdminInquiryPayload(saved);
  }

  async issueEpdaToCustomer(
    inquiryId: number,
    dto: IssueShippingAgencyEpdaDto,
    actorUserId: number,
  ): Promise<Record<string, unknown>> {
    const row = await this.requireShippingAgencyInquiry(inquiryId);
    const previousStatus = row.status;
    row.epdaSnapshot = this.validateSnapshot(dto.epdaSnapshot);
    row.status = InquiryStatus.QUOTED;
    row.quotedAt = new Date();
    row.quotedByUserId = actorUserId;

    await this.touchProcessedBy(row, actorUserId);
    const saved = await this.inquiryRepository.save(row);
    // Audit: record the issue action (status transition).
    await this.fieldChangeService.logFieldChanges(
      saved.id,
      actorUserId,
      InquiryFieldChangeAction.EPDA_ISSUE,
      [{ field: 'Status', previousValue: String(previousStatus ?? ''), newValue: String(saved.status ?? '') }],
    );
    await this.notificationService.notifyStatusChanged(saved, previousStatus);
    await this.notificationService.notifyInquiryQuotedIfNeeded(saved, previousStatus);
    return this.toAdminInquiryPayload(saved);
  }

  async listFieldChangeLogs(inquiryId: number, page = 0, size = 6) {
    const row = await this.requireShippingAgencyInquiry(inquiryId);
    return this.fieldChangeService.listForInquiry(
      inquiryId,
      page,
      size,
      row.customerSubmittedSnapshot,
    );
  }

  async listLatestCustomerFieldChanges(inquiryId: number) {
    const row = await this.requireShippingAgencyInquiry(inquiryId);
    const mainFields = ['loa', 'dwt', 'grt', 'cargoQty', 'cargoType', 'cargoName', 'port'];
    const entries = await this.fieldChangeService.listLatestForFields(
      inquiryId,
      mainFields,
      row.customerSubmittedSnapshot,
    );
    return entries.filter((e) => e.previousValue !== e.newValue);
  }

  private applyCustomerVisibleUpdates(
    row: ShippingAgencyInquiryEntity,
    dto: UpdateShippingAgencyEpdaDto,
  ): void {
    if (dto.shipownerTo !== undefined) {
      row.toName = this.trimToNull(dto.shipownerTo);
    }
    if (dto.vesselName !== undefined) {
      row.mv = this.trimToNull(dto.vesselName);
    }
    if (dto.grt !== undefined) {
      row.grt = this.toNumericString(dto.grt);
    }
    if (dto.dwt !== undefined) {
      row.dwt = this.toNumericString(dto.dwt);
    }
    if (dto.loa !== undefined) {
      row.loa = this.toNumericString(dto.loa);
    }
    if (dto.eta !== undefined) {
      row.eta = this.toDateOnly(dto.eta);
    }
    if (dto.cargoType !== undefined) {
      row.cargoType = this.trimToNull(dto.cargoType);
    }
    if (dto.cargoName !== undefined) {
      row.cargoName = this.trimToNull(dto.cargoName);
    }
    if (dto.cargoNameOther !== undefined) {
      row.cargoNameOther = this.trimToNull(dto.cargoNameOther);
    }
    if (dto.quantityTons !== undefined) {
      row.cargoQuantity = this.toNumericString(dto.quantityTons);
    }
    if (dto.frtTaxType !== undefined) {
      row.frtTaxType = this.trimToNull(dto.frtTaxType);
    }
    if (dto.purposeOfCalling !== undefined) {
      row.purposeOfCalling = this.trimToNull(dto.purposeOfCalling);
    }
    if (dto.portOfCall !== undefined) {
      row.portOfCall = this.trimToNull(dto.portOfCall);
    }
    if (dto.dischargeLoadingLocation !== undefined) {
      row.dischargeLoadingLocation = this.trimToNull(dto.dischargeLoadingLocation);
    }
    if (dto.boatHireAmount !== undefined) {
      row.boatHireAmount = this.toNumericString(dto.boatHireAmount);
    }
    if (dto.tallyFeeAmount !== undefined) {
      row.tallyFeeAmount = this.toNumericString(dto.tallyFeeAmount);
    }
    if (dto.transportLs !== undefined) {
      row.transportLs = this.trimToNull(dto.transportLs);
    }
    if (dto.transportQuarantine !== undefined) {
      row.transportQuarantine = this.trimToNull(dto.transportQuarantine);
    }
  }

  private async requireShippingAgencyInquiry(inquiryId: number): Promise<ShippingAgencyInquiryEntity> {
    const serviceType = await this.requireShippingAgencyServiceType();
    const row = await this.inquiryRepository.findOne({
      where: {
        id: inquiryId,
        serviceType: { id: serviceType.id },
      },
      relations: {
        serviceType: true,
        user: true,
        processedBy: true,
        quotedBy: true,
      },
    });

    if (!row) {
      throw new NotFoundException('Shipping agency inquiry not found');
    }

    return row;
  }

  private async requireShippingAgencyServiceType(): Promise<ServiceType> {
    const serviceType = await this.serviceTypeRepository
      .createQueryBuilder('serviceType')
      .where('LOWER(serviceType.name) = :name', {
        name: SERVICE_SHIPPING_AGENCY.toLowerCase(),
      })
      .getOne();

    if (!serviceType) {
      throw new BadRequestException('Shipping agency service type is not configured');
    }

    return serviceType;
  }

  private async touchProcessedBy(row: ShippingAgencyInquiryEntity, actorUserId: number): Promise<void> {
    if (row.processedById === actorUserId) {
      return;
    }
    const actor = await this.userRepository.findOne({ where: { id: actorUserId } });
    if (!actor) {
      throw new BadRequestException('Authenticated staff user not found');
    }
    row.processedBy = actor;
    row.processedById = actor.id;
  }

  private validateSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
    let serialized: string;
    try {
      serialized = JSON.stringify(snapshot);
    } catch {
      throw new BadRequestException('epdaSnapshot must be JSON-serializable');
    }

    if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES) {
      throw new BadRequestException(
        `epdaSnapshot exceeds maximum size of ${MAX_SNAPSHOT_BYTES} bytes`,
      );
    }

    return snapshot;
  }

  private async generateCode(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `SA-${year}-`;

    const last = await this.inquiryRepository
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

  private toAdminInquiryPayload(row: ShippingAgencyInquiryEntity): Record<string, unknown> {
    return {
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
      ...mapShippingAgencyInquiryFields(row, 'admin' satisfies InquiryResponseAudience),
    };
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

  /** All audited EPDA fields of a row as readable label → string value. */
  private epdaFieldSnapshot(row: ShippingAgencyInquiryEntity): Record<string, string | null> {
    const s = (v: unknown): string | null => {
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      const str = String(v).trim();
      return str.length ? str : null;
    };
    // Numeric fields: compare/display by value, not raw DB text. Postgres numeric
    // serializes as "54.0000"/"12000.00" — strip the trailing zeros so a format-only
    // difference (e.g. "54.0000" vs "54") is NOT recorded as a change.
    const n = (v: unknown): string | null => {
      const str = s(v);
      if (str === null) return null;
      const num = Number(str);
      return Number.isFinite(num) ? String(num) : str;
    };
    return {
      'Ship owner': s(row.toName),
      Vessel: s(row.mv),
      GRT: n(row.grt),
      DWT: n(row.dwt),
      LOA: n(row.loa),
      ETA: s(row.eta),
      'Cargo type': s(row.cargoType),
      'Cargo name': s(row.cargoName),
      'Cargo name (other)': s(row.cargoNameOther),
      Quantity: n(row.cargoQuantity),
      'Freight tax type': s(row.frtTaxType),
      'Purpose of calling': s(row.purposeOfCalling),
      'Port of call': s(row.portOfCall),
      'Discharge/loading at': s(row.dischargeLoadingLocation),
      'Quote form': s(row.quoteForm),
      'Berth hours': n(row.berthHours),
      'Anchorage hours': n(row.anchorageHours),
      'Pilotage miles': n(row.pilotage3rdMiles),
      'Document date': s(row.epdaDocumentDate),
      'Ship type': s(row.shipType),
      'Ocean freight rate': n(row.oceanFrtRateUsdPerMt),
      'Garbage cbm': n(row.garbageCbmAmount),
      'Garbage USD rate': n(row.garbageUsdRate),
      'Quarantine cargo mode': s(row.quarantineCargoMode),
      'Agency fee mode': s(row.agencyFeeMode),
      'Agency discount %': n(row.agencyDiscountPercent),
      'Agency lumpsum': n(row.agencyLumpsumAmount),
      'Boat hire (agency)': n(row.boatHireAmount),
      'Tally fee': n(row.tallyFeeAmount),
      'Transport (taxi/courier)': s(row.transportLs),
      'Boat hire (quarantine)': n(row.transportQuarantine),
    };
  }

  private diffSnapshots(
    before: Record<string, string | null>,
    after: Record<string, string | null>,
  ): Array<{ field: string; previousValue: string | null; newValue: string | null }> {
    const changes: Array<{ field: string; previousValue: string | null; newValue: string | null }> = [];
    for (const field of Object.keys(after)) {
      const prev = before[field] ?? null;
      const next = after[field] ?? null;
      if (prev !== next) changes.push({ field, previousValue: prev, newValue: next });
    }
    return changes;
  }
}
