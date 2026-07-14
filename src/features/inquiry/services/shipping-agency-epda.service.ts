import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';
import { ServiceType } from '../../logistics/entities/service-type.entity';
import { User } from '../../auth/entities/user.entity';
import { InquiryCreatedSource } from '../enums/inquiry-created-source.enum';
import { InquiryStatus } from '../enums/inquiry-status.enum';
import { UpdateShippingAgencyEpdaDto } from '../dto/update-shipping-agency-epda.dto';
import { IssueShippingAgencyEpdaDto } from '../dto/issue-shipping-agency-epda.dto';
import { LockShippingAgencyEpdaDto } from '../dto/lock-shipping-agency-epda.dto';
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
import { InquiryFieldChangeAction } from '../entities/inquiry-field-change-log.entity';
import { InquiryFieldChangeService } from './inquiry-field-change.service';
import { Port } from '../../ports/entities/port.entity';
import { normalizeProvinceAreaCode } from '../../provinces/province-area';
import {
  EPDA_QUOTE_FORM_BY_AREA,
  type EpdaQuoteForm,
} from '../constants/epda-quote-form';
import { EpdaParametersService } from '../../epda-parameters/epda-parameters.service';

const MAX_SNAPSHOT_BYTES = 256 * 1024;
const SERVICE_SHIPPING_AGENCY = 'SHIPPING AGENCY';
const SNAPSHOT_ROW_KEYS = new Set([
  'no',
  'item',
  'details',
  'add',
  'remark',
  'amount',
  'mergeItemDetails',
]);
const SNAPSHOT_ROW_COLLECTION_KEYS = new Set(['AA_ROWS', 'BB_ROWS']);
const SNAPSHOT_TOTAL_KEYS = new Set(['total_a', 'total_b', 'grand_total']);
const SNAPSHOT_KEYS = new Set([
  'to_shipowner',
  'shipowner_nationality',
  'date',
  'ref',
  'mv',
  'dwt',
  'grt',
  'loa',
  'eta',
  'cargo_qty_mt',
  'cargo_name_upper',
  'cargo_type',
  'ship_type',
  'purpose_of_calling',
  'port_upper',
  'loading_term',
  'ocean_frt_rate_usd_per_mt',
  'garbage_usd_rate',
  'garbage_cbm_amount',
  'at_anchorage',
  'at_berth',
  'total_a',
  'total_b',
  'grand_total',
  'bank_name',
  'bank_address',
  'beneficiary',
  'usd_account',
  'swift',
  'berth_hours',
  'buoy_due_hours',
  'anchorage_hours',
  'transport_quarantine',
  'quarantine_cargo_trips',
  'transport_ls',
  'boat_hire_entry',
  'agency_fee_mode',
  'agency_discount_percent',
  'agency_lumpsum_amount',
  'tally_fee',
  'tug_assistance',
  'shorecrane_hire_usd_per_mt',
  'pilotage_miles',
  'pilotage_third_miles',
  'AA_ROWS',
  'BB_ROWS',
  'params',
]);

@Injectable()
export class ShippingAgencyEpdaService {
  private readonly logger = new Logger(ShippingAgencyEpdaService.name);

  constructor(
    @InjectRepository(ShippingAgencyInquiryEntity)
    private readonly inquiryRepository: Repository<ShippingAgencyInquiryEntity>,
    @InjectRepository(ServiceType)
    private readonly serviceTypeRepository: Repository<ServiceType>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Port)
    private readonly portRepository: Repository<Port>,
    private readonly notificationService: NotificationService,
    private readonly fieldChangeService: InquiryFieldChangeService,
    private readonly epdaParametersService: EpdaParametersService,
  ) {}

  async createInternalInquiry(
    dto: CreateInternalShippingAgencyInquiryDto,
    actorUserId: number,
  ): Promise<Record<string, unknown>> {
    this.assertCompleteCreateFields(dto);
    const serviceType = await this.requireShippingAgencyServiceType();
    const customer = await this.userRepository.findOne({
      where: { id: dto.customerUserId },
    });
    if (!customer) {
      throw new BadRequestException('Customer user not found');
    }

    const canonicalPort = await this.requireCanonicalPort(dto.portId);
    const canonicalQuoteForm = this.quoteFormForPort(canonicalPort);
    this.assertCanonicalPortContract(
      canonicalPort,
      dto.portOfCall,
      dto.quoteForm,
    );

    return this.inquiryRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(ShippingAgencyInquiryEntity);
      const actor = await manager.getRepository(User).findOne({
        where: { id: actorUserId },
      });
      if (!actor) {
        throw new BadRequestException('Authenticated staff user not found');
      }
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'shipping-agency-inquiry-code',
      ]);
      const code = await this.generateCode(repository);

      const row = repository.create({
        serviceType,
        user: customer,
        fullName: customer.fullName,
        email: customer.email,
        phone: customer.phone,
        company: customer.company,
        // Staff-created EPDA: COMPLETED when all required fields are filled,
        // otherwise PROCESSING (a partially-filled draft).
        status: dto.isComplete
          ? InquiryStatus.COMPLETED
          : InquiryStatus.PROCESSING,
        notes: this.trimToNull(dto.notes),
        createdSource: InquiryCreatedSource.INTERNAL_EPDA,
        processedBy: actor,
        processedById: actor.id,
        code,
        quoteForm: canonicalQuoteForm,
        toName: this.trimToNull(dto.shipownerTo),
        mv: this.trimToNull(dto.vesselName),
        grt: this.toNumericString(dto.grt),
        dwt: this.toNumericString(dto.dwt),
        loa: this.toNumericString(dto.loa),
        eta: this.toDateOnly(dto.eta),
        cargoType: this.trimToNull(dto.cargoType),
        cargoName: this.trimToNull(dto.cargoName),
        cargoNameOther: this.trimToNull(dto.cargoNameOther),
        cargoQuantity: this.toNumericString(dto.quantityTons),
        frtTaxType: this.trimToNull(dto.frtTaxType),
        purposeOfCalling: this.trimToNull(dto.purposeOfCalling),
        portId: dto.portId,
        portOfCall: canonicalPort.portOfCall,
        dischargeLoadingLocation: this.trimToNull(dto.dischargeLoadingLocation),
        boatHireAmount: this.toNumericString(dto.boatHireAmount),
        tallyFeeAmount: this.toNumericString(dto.tallyFeeAmount),
        tugAssistanceAmount: this.toNumericString(dto.tugAssistanceAmount),
        transportLs: this.trimToNull(dto.transportLs),
        transportQuarantine: this.trimToNull(dto.transportQuarantine),
        epdaDocumentDate: this.toDateOnly(dto.epdaDocumentDate),
        shipType: this.trimToNull(dto.shipType),
        shipownerNationality:
          this.trimToNull(dto.shipownerNationality) ?? 'OVERSEAS',
        berthHours: this.toNumericString(dto.berthHours ?? 96),
        anchorageHours: this.toNumericString(dto.anchorageHours ?? 24),
        pilotage3rdMiles: this.toNumericString(
          dto.pilotage3rdMiles ?? (canonicalQuoteForm === 'QN' ? 5 : 47),
        ),
        oceanFrtRateUsdPerMt: this.toNumericString(dto.oceanFrtRateUsdPerMt),
        garbageCbmAmount: this.toNumericString(
          dto.garbageCbmAmount ?? DEFAULT_GARBAGE_CBM_AMOUNT,
        ),
        garbageUsdRate: this.toNumericString(
          dto.garbageUsdRate ?? getDefaultGarbageUsdRate(canonicalQuoteForm),
        ),
        quarantineCargoMode: this.trimToNull(dto.quarantineCargoMode),
        agencyFeeMode: this.trimToNull(dto.agencyFeeMode),
        agencyDiscountPercent: this.toNumericString(dto.agencyDiscountPercent),
        agencyLumpsumAmount: this.toNumericString(dto.agencyLumpsumAmount),
        shorecraneHireUsdPerMt: this.toNumericString(
          dto.shorecraneHireUsdPerMt,
        ),
        epdaSnapshot: null,
      });

      const saved = await repository.save(row);
      // Audit: record the initial EPDA values (previous = empty) atomically.
      await this.fieldChangeService.logFieldChanges(
        saved.id,
        actorUserId,
        InquiryFieldChangeAction.EPDA_CREATE,
        Object.entries(this.epdaFieldSnapshot(saved)).map(
          ([field, newValue]) => ({
            field,
            previousValue: null,
            newValue,
          }),
        ),
        manager,
      );
      return this.toAdminInquiryPayload(saved);
    });
  }

  async updateEpda(
    inquiryId: number,
    dto: UpdateShippingAgencyEpdaDto,
    actorUserId: number,
  ): Promise<Record<string, unknown>> {
    const result = await this.inquiryRepository.manager.transaction(
      async (manager) => {
        const { row, repository } =
          await this.requireLockedShippingAgencyInquiry(manager, inquiryId);
        return this.updateLockedEpdaRow(
          row,
          repository,
          manager,
          dto,
          actorUserId,
        );
      },
    );
    await this.runPostCommitNotification('customer field changes', () =>
      this.notificationService.notifyCustomerFieldChanges(
        result.saved,
        result.changedFields,
      ),
    );
    return result.payload;
  }

  private async updateLockedEpdaRow(
    row: ShippingAgencyInquiryEntity,
    repository: Repository<ShippingAgencyInquiryEntity>,
    manager: EntityManager,
    dto: UpdateShippingAgencyEpdaDto,
    actorUserId: number,
  ): Promise<{
    payload: Record<string, unknown>;
    saved: ShippingAgencyInquiryEntity;
    changedFields: string[];
  }> {
    this.assertEpdaUnlocked(row);
    const canonicalPort = await this.validateCanonicalPortUpdate(row, dto);
    const before = this.epdaFieldSnapshot(row);
    this.applyCustomerVisibleUpdates(row, dto);
    if (canonicalPort) row.portOfCall = canonicalPort.portOfCall;

    if (dto.quoteForm != null) {
      row.quoteForm = dto.quoteForm;
      if (
        dto.garbageUsdRate === undefined &&
        (row.garbageUsdRate == null || row.garbageUsdRate === '')
      ) {
        row.garbageUsdRate = this.toNumericString(
          getDefaultGarbageUsdRate(dto.quoteForm),
        );
      }
    }
    if (dto.berthHours !== undefined) {
      row.berthHours = this.toNumericString(dto.berthHours);
    }
    if (dto.anchorageHours !== undefined) {
      row.anchorageHours = this.toNumericString(dto.anchorageHours);
    }
    if (dto.pilotage3rdMiles !== undefined) {
      row.pilotage3rdMiles = this.toNumericString(dto.pilotage3rdMiles);
    }
    if (dto.epdaDocumentDate !== undefined) {
      row.epdaDocumentDate = this.toDateOnly(dto.epdaDocumentDate);
    }
    if (dto.shipType !== undefined) {
      row.shipType = this.trimToNull(dto.shipType);
    }
    if (dto.shipownerNationality !== undefined) {
      row.shipownerNationality = this.trimToNull(dto.shipownerNationality);
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
      row.agencyDiscountPercent = this.toNumericString(
        dto.agencyDiscountPercent,
      );
    }
    if (dto.agencyLumpsumAmount !== undefined) {
      row.agencyLumpsumAmount = this.toNumericString(dto.agencyLumpsumAmount);
    }
    // Snapshot is written only by lockEpda / issueEpdaToCustomer — not by draft saves.

    // Draft completeness drives the status: COMPLETED when all required fields
    // are filled, PROCESSING otherwise. Issuing to the customer (separate call)
    // is what moves it to QUOTED.
    if (dto.isComplete !== undefined) {
      row.status = dto.isComplete
        ? InquiryStatus.COMPLETED
        : InquiryStatus.PROCESSING;
    }

    await this.touchProcessedBy(row, actorUserId, manager);
    const saved = await repository.save(row);
    // Audit: log every changed EPDA field (full diff, all records).
    await this.fieldChangeService.logFieldChanges(
      saved.id,
      actorUserId,
      InquiryFieldChangeAction.EPDA_SAVE_DRAFT,
      this.diffSnapshots(before, this.epdaFieldSnapshot(saved)),
      manager,
    );

    const changedFields = (dto.confirmedCustomerFieldChanges ?? [])
      .filter((c) => c.previousValue !== c.newValue)
      .map((c) => c.field);
    return {
      payload: this.toAdminInquiryPayload(saved),
      saved,
      changedFields,
    };
  }

  async issueEpdaToCustomer(
    inquiryId: number,
    dto: IssueShippingAgencyEpdaDto,
    actorUserId: number,
  ): Promise<Record<string, unknown>> {
    const result = await this.inquiryRepository.manager.transaction(
      async (manager) => {
        const { row, repository } =
          await this.requireLockedShippingAgencyInquiry(manager, inquiryId);
        return this.issueLockedEpdaRow(
          row,
          repository,
          manager,
          dto,
          actorUserId,
        );
      },
    );
    await this.runPostCommitNotification('status changed', () =>
      this.notificationService.notifyStatusChanged(
        result.saved,
        result.previousStatus,
      ),
    );
    await this.runPostCommitNotification('inquiry quoted', () =>
      this.notificationService.notifyInquiryQuotedIfNeeded(
        result.saved,
        result.previousStatus,
      ),
    );
    return result.payload;
  }

  private async issueLockedEpdaRow(
    row: ShippingAgencyInquiryEntity,
    repository: Repository<ShippingAgencyInquiryEntity>,
    manager: EntityManager,
    dto: IssueShippingAgencyEpdaDto,
    actorUserId: number,
  ): Promise<{
    payload: Record<string, unknown>;
    saved: ShippingAgencyInquiryEntity;
    previousStatus: string;
  }> {
    const previousStatus = row.status;
    const requestedSnapshot = await this.buildAuthoritativeSnapshot(
      row,
      dto.epdaSnapshot,
    );
    if (row.epdaLockedAt) {
      if (!this.snapshotsEqual(row.epdaSnapshot, requestedSnapshot)) {
        throw new ConflictException(
          'EPDA is locked with a different tariff snapshot',
        );
      }
    } else {
      row.epdaSnapshot = requestedSnapshot;
      row.epdaLockedAt = new Date();
    }
    row.status = InquiryStatus.QUOTED;
    row.quotedAt = new Date();
    row.quotedByUserId = actorUserId;

    await this.touchProcessedBy(row, actorUserId, manager);
    const saved = await repository.save(row);
    // Audit: record the issue action (status transition).
    await this.fieldChangeService.logFieldChanges(
      saved.id,
      actorUserId,
      InquiryFieldChangeAction.EPDA_ISSUE,
      [
        {
          field: 'Status',
          previousValue: String(previousStatus ?? ''),
          newValue: String(saved.status ?? ''),
        },
      ],
      manager,
    );
    return {
      payload: this.toAdminInquiryPayload(saved),
      saved,
      previousStatus,
    };
  }

  /**
   * Freeze EPDA: persist live snapshot and lock further staff edits.
   * Does not change inquiry status (Issue still marks QUOTED for the customer).
   */
  async lockEpda(
    inquiryId: number,
    dto: LockShippingAgencyEpdaDto,
    actorUserId: number,
  ): Promise<Record<string, unknown>> {
    return this.inquiryRepository.manager.transaction(async (manager) => {
      const { row, repository } = await this.requireLockedShippingAgencyInquiry(
        manager,
        inquiryId,
      );
      return this.lockEpdaRow(row, repository, manager, dto, actorUserId);
    });
  }

  private async lockEpdaRow(
    row: ShippingAgencyInquiryEntity,
    repository: Repository<ShippingAgencyInquiryEntity>,
    manager: EntityManager,
    dto: LockShippingAgencyEpdaDto,
    actorUserId: number,
  ): Promise<Record<string, unknown>> {
    if (row.epdaLockedAt) {
      throw new ConflictException('EPDA is already locked');
    }
    const previousLocked = row.epdaLockedAt;
    row.epdaSnapshot = await this.buildAuthoritativeSnapshot(
      row,
      dto.epdaSnapshot,
    );
    row.epdaLockedAt = new Date();

    await this.touchProcessedBy(row, actorUserId, manager);
    const saved = await repository.save(row);
    await this.fieldChangeService.logFieldChanges(
      saved.id,
      actorUserId,
      InquiryFieldChangeAction.EPDA_LOCK,
      [
        {
          field: 'EPDA locked',
          previousValue: previousLocked ? String(previousLocked) : null,
          newValue: saved.epdaLockedAt ? String(saved.epdaLockedAt) : null,
        },
      ],
      manager,
    );
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
    const mainFields = [
      'loa',
      'dwt',
      'grt',
      'cargoQty',
      'cargoType',
      'cargoName',
      'port',
    ];
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
    if (dto.portId !== undefined) {
      row.portId = dto.portId;
    }
    if (dto.dischargeLoadingLocation !== undefined) {
      row.dischargeLoadingLocation = this.trimToNull(
        dto.dischargeLoadingLocation,
      );
    }
    if (dto.boatHireAmount !== undefined) {
      row.boatHireAmount = this.toNumericString(dto.boatHireAmount);
    }
    if (dto.tallyFeeAmount !== undefined) {
      row.tallyFeeAmount = this.toNumericString(dto.tallyFeeAmount);
    }
    if (dto.tugAssistanceAmount !== undefined) {
      row.tugAssistanceAmount = this.toNumericString(dto.tugAssistanceAmount);
    }
    if (dto.shorecraneHireUsdPerMt !== undefined) {
      row.shorecraneHireUsdPerMt =
        dto.shorecraneHireUsdPerMt === null
          ? null
          : this.toNumericString(dto.shorecraneHireUsdPerMt);
    }
    if (dto.transportLs !== undefined) {
      row.transportLs = this.trimToNull(dto.transportLs);
    }
    if (dto.transportQuarantine !== undefined) {
      row.transportQuarantine = this.trimToNull(dto.transportQuarantine);
    }
  }

  private assertEpdaUnlocked(row: ShippingAgencyInquiryEntity): void {
    if (row.epdaLockedAt) {
      throw new ConflictException(
        'EPDA is locked. Unlock is not supported — create a new EPDA to change fields.',
      );
    }
  }

  private async requireShippingAgencyInquiry(
    inquiryId: number,
  ): Promise<ShippingAgencyInquiryEntity> {
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

  private async requireLockedShippingAgencyInquiry(
    manager: EntityManager,
    inquiryId: number,
  ): Promise<{
    row: ShippingAgencyInquiryEntity;
    repository: Repository<ShippingAgencyInquiryEntity>;
  }> {
    const serviceType = await this.requireShippingAgencyServiceType();
    const repository = manager.getRepository(ShippingAgencyInquiryEntity);
    const row = await repository
      .createQueryBuilder('inquiry')
      .leftJoinAndSelect('inquiry.serviceType', 'serviceType')
      .leftJoinAndSelect('inquiry.user', 'user')
      .leftJoinAndSelect('inquiry.processedBy', 'processedBy')
      .leftJoinAndSelect('inquiry.quotedBy', 'quotedBy')
      .where('inquiry.id = :inquiryId', { inquiryId })
      .andWhere('serviceType.id = :serviceTypeId', {
        serviceTypeId: serviceType.id,
      })
      .setLock('pessimistic_write')
      .getOne();

    if (!row) throw new NotFoundException('Shipping agency inquiry not found');
    return { row, repository };
  }

  private async requireShippingAgencyServiceType(): Promise<ServiceType> {
    const serviceType = await this.serviceTypeRepository
      .createQueryBuilder('serviceType')
      .where('LOWER(serviceType.name) = :name', {
        name: SERVICE_SHIPPING_AGENCY.toLowerCase(),
      })
      .getOne();

    if (!serviceType) {
      throw new BadRequestException(
        'Shipping agency service type is not configured',
      );
    }

    return serviceType;
  }

  private async touchProcessedBy(
    row: ShippingAgencyInquiryEntity,
    actorUserId: number,
    manager?: EntityManager,
  ): Promise<void> {
    if (row.processedById === actorUserId) {
      return;
    }
    const actorRepository = manager?.getRepository(User) ?? this.userRepository;
    const actor = await actorRepository.findOne({
      where: { id: actorUserId },
    });
    if (!actor) {
      throw new BadRequestException('Authenticated staff user not found');
    }
    row.processedBy = actor;
    row.processedById = actor.id;
  }

  /**
   * Database state is already committed when this runs. Notification delivery
   * is best-effort so an outage cannot turn a committed mutation into a ghost
   * failure that callers retry.
   */
  private async runPostCommitNotification(
    label: string,
    task: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Post-commit notification failed (${label}): ${message}`,
      );
    }
  }

  private async requireCanonicalPort(portId: number): Promise<Port> {
    const port = await this.portRepository.findOne({
      where: { id: portId },
      relations: { province: true },
    });
    if (!port) throw new BadRequestException(`Port ${portId} not found`);
    return port;
  }

  private async validateCanonicalPortUpdate(
    row: ShippingAgencyInquiryEntity,
    dto: UpdateShippingAgencyEpdaDto,
  ): Promise<Port | null> {
    if (dto.portId === null) return null;
    const portId = dto.portId ?? row.portId;
    if (
      !portId ||
      (dto.portId === undefined &&
        dto.portOfCall === undefined &&
        dto.quoteForm === undefined)
    ) {
      return null;
    }
    const port = await this.requireCanonicalPort(portId);
    this.assertCanonicalPortContract(
      port,
      dto.portOfCall ?? row.portOfCall,
      dto.quoteForm ?? (row.quoteForm as EpdaQuoteForm | null),
    );
    return port;
  }

  private assertCanonicalPortContract(
    port: Port,
    portOfCall: string | null | undefined,
    quoteForm: EpdaQuoteForm | null | undefined,
  ): void {
    const canonicalName = this.normalizePortLabel(port.portOfCall);
    if (portOfCall && this.normalizePortLabel(portOfCall) !== canonicalName) {
      throw new BadRequestException(
        `portOfCall does not match canonical port ${port.id} (${port.portOfCall})`,
      );
    }
    const expectedForm = this.quoteFormForPort(port);
    if (quoteForm && quoteForm !== expectedForm) {
      throw new BadRequestException(
        `Port ${port.id} belongs to quote form ${expectedForm}, not ${quoteForm}`,
      );
    }
  }

  private quoteFormForPort(port: Port): EpdaQuoteForm {
    const area = normalizeProvinceAreaCode(port.province?.area ?? null);
    if (!area)
      throw new BadRequestException(`Port ${port.id} has no EPDA area`);
    return EPDA_QUOTE_FORM_BY_AREA[
      String(area) as keyof typeof EPDA_QUOTE_FORM_BY_AREA
    ];
  }

  private normalizePortLabel(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toUpperCase();
  }

  private validateSnapshot(
    snapshot: Record<string, unknown>,
  ): Record<string, unknown> {
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

  /**
   * Tariff parameters are server-owned. The client must calculate its quote
   * from the same effective values the server currently resolves; otherwise
   * freezing the remaining quote fields would persist a stale calculation.
   */
  private async buildAuthoritativeSnapshot(
    row: ShippingAgencyInquiryEntity,
    requestedSnapshot: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const requested = this.validateSnapshot(requestedSnapshot);
    this.validateSnapshotShape(requested);
    if (!this.isJsonObject(requested.params)) {
      throw new BadRequestException(
        'EPDA snapshot params must be a parameter object',
      );
    }

    if (row.epdaLockedAt) {
      return requested;
    }

    if (!Number.isInteger(row.portId) || (row.portId ?? 0) <= 0) {
      throw new BadRequestException(
        'A canonical portId is required to freeze EPDA tariff parameters',
      );
    }
    const effectiveParams = await this.epdaParametersService.getEffective(
      undefined,
      row.portId as number,
    );
    if (!this.jsonValuesEqual(requested.params, effectiveParams)) {
      throw new ConflictException(
        'EPDA tariff parameters are stale; refresh effective parameters and recalculate the quote',
      );
    }
    return this.validateSnapshot({
      ...requested,
      params: structuredClone(effectiveParams),
    });
  }

  private isJsonObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private jsonValuesEqual(left: unknown, right: unknown): boolean {
    return (
      JSON.stringify(this.sortSnapshot(left)) ===
      JSON.stringify(this.sortSnapshot(right))
    );
  }

  private validateSnapshotShape(snapshot: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(snapshot)) {
      if (!SNAPSHOT_KEYS.has(key)) {
        throw new BadRequestException(
          `Unsupported EPDA snapshot field: ${key}`,
        );
      }
      if (key === 'params') continue;
      if (SNAPSHOT_ROW_COLLECTION_KEYS.has(key)) {
        this.validateSnapshotRows(key, value);
        continue;
      }
      if (SNAPSHOT_TOTAL_KEYS.has(key)) {
        this.assertNonNegativeFiniteAmount(key, value);
        continue;
      }
      if (
        value !== null &&
        value !== undefined &&
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      ) {
        throw new BadRequestException(
          `EPDA snapshot field ${key} must be a primitive value`,
        );
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new BadRequestException(
          `EPDA snapshot field ${key} must be finite`,
        );
      }
    }
  }

  private validateSnapshotRows(key: string, value: unknown): void {
    if (!Array.isArray(value) || value.length > 200) {
      throw new BadRequestException(
        `EPDA snapshot field ${key} must contain at most 200 rows`,
      );
    }
    value.forEach((entry, index) => {
      if (!this.isJsonObject(entry)) {
        throw new BadRequestException(`${key}[${index}] must be an object`);
      }
      for (const [rowKey, rowValue] of Object.entries(entry)) {
        if (!SNAPSHOT_ROW_KEYS.has(rowKey)) {
          throw new BadRequestException(
            `Unsupported EPDA snapshot row field: ${key}[${index}].${rowKey}`,
          );
        }
        if (rowKey === 'amount') {
          this.assertNonNegativeFiniteAmount(
            `${key}[${index}].amount`,
            rowValue,
          );
        } else if (
          rowValue !== null &&
          rowValue !== undefined &&
          typeof rowValue !== 'string' &&
          typeof rowValue !== 'number' &&
          typeof rowValue !== 'boolean'
        ) {
          throw new BadRequestException(
            `EPDA snapshot row field ${key}[${index}].${rowKey} must be primitive`,
          );
        }
      }
    });
  }

  private assertNonNegativeFiniteAmount(path: string, value: unknown): void {
    if (value === null || value === undefined || value === '') return;
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value.replace(/,/g, '').trim())
          : Number.NaN;
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new BadRequestException(
        `EPDA snapshot amount ${path} must be finite and non-negative`,
      );
    }
  }

  private async generateCode(
    repository: Repository<ShippingAgencyInquiryEntity> = this
      .inquiryRepository,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `SA-${year}-`;

    const last = await repository
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

  private toAdminInquiryPayload(
    row: ShippingAgencyInquiryEntity,
  ): Record<string, unknown> {
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
      ...mapShippingAgencyInquiryFields(
        row,
        'admin' satisfies InquiryResponseAudience,
      ),
    };
  }

  private assertCompleteCreateFields(
    dto: CreateInternalShippingAgencyInquiryDto,
  ): void {
    if (!dto.isComplete) {
      return;
    }

    const requiredFields = [
      ['shipownerTo', dto.shipownerTo],
      ['vesselName', dto.vesselName],
      ['dischargeLoadingLocation', dto.dischargeLoadingLocation],
    ] as const;
    const missingFields = requiredFields
      .filter(([, value]) => this.trimToNull(value) === null)
      .map(([field]) => field);

    if (missingFields.length > 0) {
      throw new BadRequestException(
        `Complete EPDA requires: ${missingFields.join(', ')}`,
      );
    }
  }

  private trimToNull(value?: string | null): string | null {
    if (value == null) {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private toDateOnly(value?: string | null): string | null {
    if (!value?.trim()) {
      return null;
    }
    return value.trim();
  }

  private toNumericString(value?: number | null): string | null {
    if (value == null || Number.isNaN(value)) {
      return null;
    }
    return String(value);
  }

  /** All audited EPDA fields of a row as readable label → string value. */
  private epdaFieldSnapshot(
    row: ShippingAgencyInquiryEntity,
  ): Record<string, string | null> {
    const s = (v: unknown): string | null => {
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      let serialized: string;
      if (typeof v === 'string') serialized = v;
      else if (
        typeof v === 'number' ||
        typeof v === 'boolean' ||
        typeof v === 'bigint'
      ) {
        serialized = v.toString();
      } else if (typeof v === 'object') {
        serialized = JSON.stringify(v);
      } else {
        return null;
      }
      const str = serialized.trim();
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
      'Shipowner nationality': s(row.shipownerNationality),
      'Ocean freight rate': n(row.oceanFrtRateUsdPerMt),
      'Garbage cbm': n(row.garbageCbmAmount),
      'Garbage USD rate': n(row.garbageUsdRate),
      'Quarantine cargo mode': s(row.quarantineCargoMode),
      'Agency fee mode': s(row.agencyFeeMode),
      'Agency discount %': n(row.agencyDiscountPercent),
      'Agency lumpsum': n(row.agencyLumpsumAmount),
      'Boat hire (agency)': n(row.boatHireAmount),
      'Tally fee': n(row.tallyFeeAmount),
      'Tug assistance': n(row.tugAssistanceAmount),
      'Shorecrane-hire USD/mt': n(row.shorecraneHireUsdPerMt),
      'Transport (taxi/courier)': s(row.transportLs),
      'Boat hire (quarantine)': n(row.transportQuarantine),
    };
  }

  private diffSnapshots(
    before: Record<string, string | null>,
    after: Record<string, string | null>,
  ): Array<{
    field: string;
    previousValue: string | null;
    newValue: string | null;
  }> {
    const changes: Array<{
      field: string;
      previousValue: string | null;
      newValue: string | null;
    }> = [];
    for (const field of Object.keys(after)) {
      const prev = before[field] ?? null;
      const next = after[field] ?? null;
      if (prev !== next)
        changes.push({ field, previousValue: prev, newValue: next });
    }
    return changes;
  }

  private snapshotsEqual(
    left: Record<string, unknown> | null,
    right: Record<string, unknown>,
  ): boolean {
    if (left === null) return false;
    return (
      JSON.stringify(this.sortSnapshot(left)) ===
      JSON.stringify(this.sortSnapshot(right))
    );
  }

  private sortSnapshot(value: unknown): unknown {
    if (Array.isArray(value))
      return value.map((entry) => this.sortSnapshot(entry));
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, this.sortSnapshot(entry)]),
    );
  }
}
