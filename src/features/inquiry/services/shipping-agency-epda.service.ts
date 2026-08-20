import {
  BadRequestException,
  ConflictException,
  Injectable,
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
import { LockShippingAgencyEpdaDto } from '../dto/lock-shipping-agency-epda.dto';
import { CreateInternalShippingAgencyInquiryDto } from '../dto/create-internal-shipping-agency-inquiry.dto';
import { getDefaultGarbageUsdRate } from '../constants/epda-garbage.defaults';
import {
  InquiryResponseAudience,
  mapShippingAgencyInquiryFields,
} from '../mappers/shipping-agency-inquiry.mapper';
import { InquiryFieldChangeAction } from '../entities/inquiry-field-change-log.entity';
import { InquiryFieldChangeService } from './inquiry-field-change.service';
import { Port } from '../../ports/entities/port.entity';
import { Commodity } from '../../commodities/entities/commodity.entity';
import { CommodityType } from '../../commodities/entities/commodity-type.entity';
import type { EpdaParameterValues } from '../../epda-parameters/entities/epda-parameter-set.entity';
import { normalizeProvinceAreaCode } from '../../provinces/province-area';
import {
  EPDA_QUOTE_FORM_BY_AREA,
  type EpdaQuoteForm,
} from '../constants/epda-quote-form';
import {
  diffEpdaFieldSnapshots,
  epdaFieldSnapshot,
} from './shipping-agency-epda-audit';
import { ShippingAgencyEpdaSnapshotService } from './shipping-agency-epda-snapshot.service';
import { normalizeEpdaWorkingParams } from './shipping-agency-epda-working-params';
import { InquiryCodeAllocator } from './inquiry-code-allocator';
import { InquiryRepositoryRegistry } from './inquiry-repository.registry';

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
    @InjectRepository(Port)
    private readonly portRepository: Repository<Port>,
    private readonly fieldChangeService: InquiryFieldChangeService,
    private readonly snapshotService: ShippingAgencyEpdaSnapshotService,
    private readonly codeAllocator: InquiryCodeAllocator,
    private readonly repositories: InquiryRepositoryRegistry,
  ) {}

  async createInternalInquiry(
    dto: CreateInternalShippingAgencyInquiryDto,
    actorUserId: number,
  ): Promise<Record<string, unknown>> {
    const serviceType = await this.requireShippingAgencyServiceType();
    const canonicalPort = await this.requireCanonicalPort(dto.portId);
    const canonicalQuoteForm = this.quoteFormForPort(canonicalPort);
    this.assertCanonicalPortContract(
      canonicalPort,
      dto.portOfCall,
      dto.quoteForm,
    );
    const effectiveParams =
      await this.snapshotService.resolveEffectiveParamsForPort(dto.portId);

    return this.inquiryRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(ShippingAgencyInquiryEntity);
      const actor = await manager.getRepository(User).findOne({
        where: { id: actorUserId },
      });
      if (!actor) {
        throw new BadRequestException('Authenticated staff user not found');
      }
      const prefix = this.repositories.codePrefix(SERVICE_SHIPPING_AGENCY);
      const code = await this.codeAllocator.allocate(
        manager,
        repository,
        prefix,
      );
      const catalog = await this.resolveCatalogSelection(
        dto.commodityTypeId,
        dto.commodityId,
        serviceType.id,
        manager,
      );

      const row = repository.create({
        serviceType,
        // BaseInquiry.user is the legacy non-null owner. For INTERNAL_EPDA it
        // is the authenticated creator; the API exposes clientSubmittedBy=null.
        user: actor,
        fullName: actor.fullName,
        email: actor.email,
        phone: actor.phone,
        company: actor.company,
        status: InquiryStatus.PROCESSING,
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
        commodityTypeId: dto.commodityTypeId ?? null,
        commodityId: dto.commodityId ?? null,
        cargoType:
          catalog.commodityType?.name ?? this.trimToNull(dto.cargoType),
        cargoName: catalog.commodity?.name ?? this.trimToNull(dto.cargoName),
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
        tugAssistanceTrips: dto.tugAssistanceTrips ?? 2,
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
        garbageUsdRate: this.toNumericString(
          dto.garbageUsdRate ?? getDefaultGarbageUsdRate(canonicalQuoteForm),
        ),
        quarantineCargoMode: this.trimToNull(dto.quarantineCargoMode),
        agencyFeeMode: this.trimToNull(dto.agencyFeeMode),
        agencyDiscountPercent: this.toNumericString(dto.agencyDiscountPercent),
        agencyLumpsumAmount: this.toNumericString(dto.agencyLumpsumAmount),
        agencyOtherExpenses: this.normalizeAgencyOtherExpenses(
          dto.agencyOtherExpenses,
        ),
        shorecraneHireUsdPerMt: this.toNumericString(
          dto.shorecraneHireUsdPerMt,
        ),
        epdaSnapshot: null,
        epdaWorkingParams: normalizeEpdaWorkingParams(
          effectiveParams as unknown as Record<string, unknown>,
        ),
      });

      row.status = this.epdaStatus(row);

      const saved = await repository.save(row);
      // Audit: record the initial EPDA values (previous = empty) atomically.
      await this.fieldChangeService.logFieldChanges(
        saved.id,
        actorUserId,
        InquiryFieldChangeAction.EPDA_CREATE,
        Object.entries(epdaFieldSnapshot(saved)).map(([field, newValue]) => ({
          field,
          previousValue: null,
          newValue,
        })),
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
  }> {
    this.assertEpdaUnlocked(row);
    const previousPortId = row.portId;
    const previousWorkingParams = row.epdaWorkingParams;
    const canonicalPort = await this.validateCanonicalPortUpdate(
      row,
      dto,
      manager,
    );
    const before = epdaFieldSnapshot(row);
    this.applyCustomerVisibleUpdates(row, dto);
    await this.applyCatalogSelectionUpdate(row, dto, manager);
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
    if (dto.garbageUsdRate !== undefined) {
      row.garbageUsdRate = this.toNumericString(dto.garbageUsdRate);
    }
    if (dto.quarantineCargoMode !== undefined) {
      row.quarantineCargoMode = this.trimToNull(dto.quarantineCargoMode);
    }
    if (dto.agencyFeeMode !== undefined) {
      row.agencyFeeMode = this.trimToNull(dto.agencyFeeMode);
      if (
        row.agencyFeeMode !== 'LUMPSUM' &&
        dto.agencyOtherExpenses === undefined
      ) {
        row.agencyOtherExpenses = null;
      }
    }
    if (dto.agencyDiscountPercent !== undefined) {
      row.agencyDiscountPercent = this.toNumericString(
        dto.agencyDiscountPercent,
      );
    }
    if (dto.agencyLumpsumAmount !== undefined) {
      row.agencyLumpsumAmount = this.toNumericString(dto.agencyLumpsumAmount);
    }
    if (dto.agencyOtherExpenses !== undefined) {
      row.agencyOtherExpenses = this.normalizeAgencyOtherExpenses(
        dto.agencyOtherExpenses,
      );
    }
    await this.applyAuthoritativeWorkingParams(
      row,
      dto.epdaWorkingParams,
      previousPortId,
      previousWorkingParams,
      manager,
    );
    row.status = this.epdaStatus(row);

    await this.touchProcessedBy(row, actorUserId, manager);
    const saved = await repository.save(row);
    // Audit: log every changed EPDA field (full diff, all records).
    await this.fieldChangeService.logFieldChanges(
      saved.id,
      actorUserId,
      InquiryFieldChangeAction.EPDA_SAVE_DRAFT,
      diffEpdaFieldSnapshots(before, epdaFieldSnapshot(saved)),
      manager,
    );

    return {
      payload: this.toAdminInquiryPayload(saved),
    };
  }

  /**
   * Freeze EPDA: persist client-pinned tariff params into `epdaSnapshot`
   * and lock further staff edits. Does not change inquiry status.
   *
   * Pre-resolves live params before the row lock (DB-01). Snapshot lock
   * accepts Apply (params === live) or Skip (params === epdaWorkingParams);
   * anything else is 409.
   */
  async lockEpda(
    inquiryId: number,
    dto: LockShippingAgencyEpdaDto,
    actorUserId: number,
  ): Promise<Record<string, unknown>> {
    // Resolve read-only tariff params before the row lock so getEffective
    // does not check out a second pool connection while FOR UPDATE is held.
    const preview = await this.requireShippingAgencyInquiry(inquiryId);
    const previewPortId = preview.portId;
    const effectiveParams =
      !preview.epdaLockedAt &&
      Number.isInteger(previewPortId) &&
      (previewPortId ?? 0) > 0
        ? await this.snapshotService.resolveEffectiveParamsForPort(
            previewPortId as number,
          )
        : undefined;

    return this.inquiryRepository.manager.transaction(async (manager) => {
      const { row, repository } = await this.requireLockedShippingAgencyInquiry(
        manager,
        inquiryId,
      );
      return this.lockEpdaRow(
        row,
        repository,
        manager,
        dto,
        actorUserId,
        effectiveParams,
        previewPortId,
      );
    });
  }

  private async lockEpdaRow(
    row: ShippingAgencyInquiryEntity,
    repository: Repository<ShippingAgencyInquiryEntity>,
    manager: EntityManager,
    dto: LockShippingAgencyEpdaDto,
    actorUserId: number,
    preResolvedEffectiveParams?: EpdaParameterValues | Record<string, unknown>,
    previewPortId?: number | null,
  ): Promise<Record<string, unknown>> {
    if (row.epdaLockedAt) {
      throw new ConflictException('EPDA is already locked');
    }
    const missingFields = this.missingCompleteFields(row);
    if (missingFields.length > 0) {
      throw new BadRequestException(
        `Cannot lock incomplete EPDA. Missing: ${missingFields.join(', ')}`,
      );
    }
    row.status = InquiryStatus.COMPLETED;
    const previousLocked = row.epdaLockedAt;
    const portUnchanged =
      preResolvedEffectiveParams != null && row.portId === previewPortId;
    // When portId changed after preview, re-resolve on this transaction
    // connection so Apply can still match live for the locked row's port.
    const effectiveParams = portUnchanged
      ? preResolvedEffectiveParams
      : Number.isInteger(row.portId) && (row.portId ?? 0) > 0
        ? await this.snapshotService.resolveEffectiveParamsForPort(
            row.portId as number,
            manager,
          )
        : undefined;
    row.epdaSnapshot = await this.snapshotService.buildAuthoritativeSnapshot(
      row,
      dto.epdaSnapshot,
      { effectiveParams },
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

  async unlockEpda(
    inquiryId: number,
    actorUserId: number,
  ): Promise<Record<string, unknown>> {
    return this.inquiryRepository.manager.transaction(async (manager) => {
      const { row, repository } = await this.requireLockedShippingAgencyInquiry(
        manager,
        inquiryId,
      );
      if (!row.epdaLockedAt) {
        throw new ConflictException('EPDA is not locked');
      }

      const previousLockedAt = row.epdaLockedAt;
      row.epdaLockedAt = null;
      await this.touchProcessedBy(row, actorUserId, manager);
      const saved = await repository.save(row);
      await this.fieldChangeService.logFieldChanges(
        saved.id,
        actorUserId,
        InquiryFieldChangeAction.EPDA_UNLOCK,
        [
          {
            field: 'EPDA locked',
            previousValue: String(previousLockedAt),
            newValue: null,
          },
        ],
        manager,
      );
      return this.toAdminInquiryPayload(saved);
    });
  }

  async listFieldChangeLogs(inquiryId: number, page = 0, size = 6) {
    await this.requireShippingAgencyInquiry(inquiryId);
    return this.fieldChangeService.listForInquiry(inquiryId, page, size);
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
    if (dto.tugAssistanceTrips !== undefined) {
      row.tugAssistanceTrips =
        dto.tugAssistanceTrips === null ? null : dto.tugAssistanceTrips;
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
        'EPDA is locked. Only an administrator can unlock edit.',
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
    const serviceType = await this.requireShippingAgencyServiceType(manager);
    const repository = manager.getRepository(ShippingAgencyInquiryEntity);
    // Lock only the inquiry row. Postgres rejects FOR UPDATE on the nullable
    // side of LEFT JOINs, so we must not lock joined tables.
    const row = await repository
      .createQueryBuilder('inquiry')
      .leftJoinAndSelect('inquiry.serviceType', 'serviceType')
      .leftJoinAndSelect('inquiry.user', 'user')
      .leftJoinAndSelect('inquiry.processedBy', 'processedBy')
      .leftJoinAndSelect('inquiry.quotedBy', 'quotedBy')
      .where('inquiry.id = :inquiryId', { inquiryId })
      .andWhere('inquiry.serviceTypeId = :serviceTypeId', {
        serviceTypeId: serviceType.id,
      })
      .setLock('pessimistic_write', undefined, ['inquiry'])
      .getOne();

    if (!row) throw new NotFoundException('Shipping agency inquiry not found');
    return { row, repository };
  }

  private async requireShippingAgencyServiceType(
    manager?: EntityManager,
  ): Promise<ServiceType> {
    const repository =
      manager?.getRepository(ServiceType) ?? this.serviceTypeRepository;
    const serviceType = await repository
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

  private async resolveCatalogSelection(
    commodityTypeId: number | null | undefined,
    commodityId: number | null | undefined,
    serviceTypeId: number,
    manager: EntityManager,
  ): Promise<{
    commodityType: CommodityType | null;
    commodity: Commodity | null;
  }> {
    const commodityType =
      commodityTypeId == null
        ? null
        : await manager.getRepository(CommodityType).findOne({
            where: { id: commodityTypeId },
          });
    if (
      commodityTypeId != null &&
      (!commodityType || commodityType.serviceTypeId !== serviceTypeId)
    ) {
      throw new BadRequestException(
        'Commodity Type does not belong to Shipping Agency Service',
      );
    }

    const commodity =
      commodityId == null
        ? null
        : await manager.getRepository(Commodity).findOne({
            where: { id: commodityId },
          });
    if (
      commodityId != null &&
      (!commodity || commodity.serviceTypeId !== serviceTypeId)
    ) {
      throw new BadRequestException(
        'Commodity does not belong to Shipping Agency Service',
      );
    }

    return { commodityType, commodity };
  }

  private async applyCatalogSelectionUpdate(
    row: ShippingAgencyInquiryEntity,
    dto: UpdateShippingAgencyEpdaDto,
    manager: EntityManager,
  ): Promise<void> {
    if (dto.commodityTypeId === undefined && dto.commodityId === undefined) {
      return;
    }
    const catalog = await this.resolveCatalogSelection(
      dto.commodityTypeId,
      dto.commodityId,
      row.serviceType.id,
      manager,
    );
    if (dto.commodityTypeId !== undefined) {
      row.commodityTypeId = dto.commodityTypeId;
      if (catalog.commodityType) row.cargoType = catalog.commodityType.name;
    }
    if (dto.commodityId !== undefined) {
      row.commodityId = dto.commodityId;
      if (catalog.commodity) row.cargoName = catalog.commodity.name;
    }
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

  private async requireCanonicalPort(
    portId: number,
    manager?: EntityManager,
  ): Promise<Port> {
    const repository = manager?.getRepository(Port) ?? this.portRepository;
    const port = await repository.findOne({
      where: { id: portId },
      relations: { province: true },
    });
    if (!port) throw new BadRequestException(`Port ${portId} not found`);
    return port;
  }

  private async validateCanonicalPortUpdate(
    row: ShippingAgencyInquiryEntity,
    dto: UpdateShippingAgencyEpdaDto,
    manager?: EntityManager,
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
    const port = await this.requireCanonicalPort(portId, manager);
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

  private async applyAuthoritativeWorkingParams(
    row: ShippingAgencyInquiryEntity,
    requested: Record<string, unknown> | undefined,
    previousPortId: number | null,
    previousWorkingParams: Record<string, unknown> | null,
    manager: EntityManager,
  ): Promise<void> {
    if (!Number.isInteger(row.portId) || (row.portId ?? 0) <= 0) {
      row.epdaWorkingParams = null;
      return;
    }

    const portUnchanged = row.portId === previousPortId;
    if (requested === undefined && portUnchanged && previousWorkingParams) {
      return;
    }

    const effective = await this.snapshotService.resolveEffectiveParamsForPort(
      row.portId as number,
      manager,
    );
    const normalizedRequested = requested
      ? normalizeEpdaWorkingParams(requested)
      : undefined;
    const keepsServerPinnedParams =
      // ponytail: pre-hardening drafts have no provenance marker; reset their
      // working params during rollout if untrusted clients could write them.
      portUnchanged &&
      normalizedRequested != null &&
      previousWorkingParams != null &&
      this.snapshotService.snapshotsEqual(
        previousWorkingParams,
        normalizedRequested,
      );
    const appliesCurrentParams =
      normalizedRequested == null ||
      this.snapshotService.snapshotsEqual(
        effective as unknown as Record<string, unknown>,
        normalizedRequested,
      );

    if (!keepsServerPinnedParams && !appliesCurrentParams) {
      throw new ConflictException(
        'EPDA working parameters must match the server-pinned set or current effective parameters',
      );
    }

    row.epdaWorkingParams = keepsServerPinnedParams
      ? normalizeEpdaWorkingParams(previousWorkingParams)
      : normalizeEpdaWorkingParams(
          effective as unknown as Record<string, unknown>,
        );
  }

  private epdaStatus(row: ShippingAgencyInquiryEntity): InquiryStatus {
    return this.missingCompleteFields(row).length === 0
      ? InquiryStatus.COMPLETED
      : InquiryStatus.PROCESSING;
  }

  private missingCompleteFields(row: ShippingAgencyInquiryEntity): string[] {
    const positiveNumericFields = new Set([
      'dwt',
      'grt',
      'loa',
      'quantityTons',
    ]);
    const requiredFields: Array<[string, unknown]> = [
      ['shipownerTo', row.toName],
      ['vesselName', row.mv],
      ['dischargeLoadingLocation', row.dischargeLoadingLocation],
      ['dwt', row.dwt],
      ['grt', row.grt],
      ['loa', row.loa],
      ['quantityTons', row.cargoQuantity],
      ['cargoType', row.cargoType],
      ['purposeOfCalling', row.purposeOfCalling],
      ['portId', row.portId],
    ];
    const cargoName = this.trimToNull(row.cargoName ?? row.cargoNameOther);
    if (!cargoName && row.commodityId != null) {
      requiredFields.push(['cargoName', null]);
    }
    const purpose = this.normalizeOptionCode(row.purposeOfCalling);
    if (purpose === 'NHAP_XUAT' || purpose === 'CHUYEN_CANG_XUAT') {
      requiredFields.push(['frtTaxType', row.frtTaxType]);
    }
    return requiredFields
      .filter(([field, value]) => {
        if (value == null) return true;
        if (positiveNumericFields.has(field)) {
          const numeric = Number(value);
          return !Number.isFinite(numeric) || numeric <= 0;
        }
        if (typeof value === 'string') return value.trim() === '';
        if (typeof value === 'number') return !Number.isFinite(value);
        return false;
      })
      .map(([field]) => field);
  }

  private normalizeOptionCode(value: string | null | undefined): string {
    return String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
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

  /**
   * Persist only clean `{ name, amount }` rows. Empty / blank names are dropped.
   * Returns null when there are no usable rows.
   */
  private normalizeAgencyOtherExpenses(
    value?: { name?: string; amount?: number }[] | null,
  ): { name: string; amount: number }[] | null {
    if (value == null) return null;
    if (!Array.isArray(value)) return null;
    const normalized = value
      .map((item) => {
        const name = typeof item?.name === 'string' ? item.name.trim() : '';
        const amount = Number(item?.amount);
        if (!name || !Number.isFinite(amount) || amount < 0) return null;
        return { name: name.slice(0, 255), amount };
      })
      .filter((item): item is { name: string; amount: number } => item != null);
    return normalized.length > 0 ? normalized : null;
  }
}
