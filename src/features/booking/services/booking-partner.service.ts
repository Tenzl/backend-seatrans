import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  EntityManager,
  In,
  IsNull,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { BookingPartner } from '../entities/booking-partner.entity';
import { BookingPartnerAdditionTypeEntity } from '../entities/booking-partner-addition-type.entity';
import { ListBookingPartnersDto } from '../dto/list-booking-partners.dto';
import {
  PartnerContactDto,
  UpsertBookingPartnerDto,
} from '../dto/upsert-booking-partner.dto';
import { PartnerContact } from '../types/partner-contact';
import {
  BookingPartnerDetailResponseDto,
  BookingPartnerListItemResponseDto,
} from '../dto/booking-partner-response.dto';
import { buildPaginatedResponse } from '../../../shared/dto/pagination.dto';
import {
  PartnerOptionDto,
  PartnerOptionPageDto,
} from '../dto/partner-option.dto';
import { ListPartnerOptionsQueryDto } from '../dto/list-partner-options-query.dto';
import { PartnerAdditionType } from '../enums/partner-addition-type.enum';
import { UpdateCustomerStatusDto } from '../dto/update-customer-status.dto';
import { BookingPartnerFieldChangeAction } from '../entities/booking-partner-field-change-log.entity';
import {
  diffPartnerFieldSnapshots,
  partnerFieldSnapshot,
} from './booking-partner-audit';
import { BookingPartnerFieldChangeService } from './booking-partner-field-change.service';
import { buildPartnerContainsPattern } from './partner-search';
import { saveWithOptimisticLock } from '../../../shared/utils/optimistic-lock';

@Injectable()
export class BookingPartnerService {
  private static readonly DEFAULT_PAGE_SIZE = 20;
  private static readonly MAX_PAGE_SIZE = 100;
  private static readonly DEFAULT_OPTIONS_LIMIT = 10;
  private static readonly MAX_OPTIONS_LIMIT = 10;
  constructor(
    @InjectRepository(BookingPartner)
    private readonly partnerRepository: Repository<BookingPartner>,
    private readonly dataSource: DataSource,
    private readonly fieldChangeService: BookingPartnerFieldChangeService,
  ) {}

  async listPartnerOptions(
    query: ListPartnerOptionsQueryDto,
  ): Promise<PartnerOptionPageDto> {
    const normalizedQ = query.q?.trim().toLowerCase() ?? '';
    const page = this.sanitizePage(query.page);
    const take = this.sanitizeOptionsLimit(
      query.limit ?? BookingPartnerService.DEFAULT_OPTIONS_LIMIT,
    );

    const qb = this.partnerRepository
      .createQueryBuilder('partner')
      .select([
        'partner.id',
        'partner.name',
        'partner.customerId',
        'partner.address',
        'partner.city',
        'partner.country',
        'partner.phone',
        'partner.fax',
      ])
      .where('partner.deletedAt IS NULL')
      .orderBy('partner.name', 'ASC')
      .addOrderBy('partner.id', 'ASC')
      .skip(page * take)
      .take(take + 1);

    if (query.customerType) {
      qb.andWhere('partner.customerType = :customerType', {
        customerType: query.customerType,
      });
    }

    if (query.additionType) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM booking_partner_addition_types option_tag
          WHERE option_tag.partner_id = partner.id
            AND option_tag.addition_type = :additionType
        )`,
        { additionType: query.additionType },
      );
    }

    if (normalizedQ.length > 0) {
      const containsPattern = buildPartnerContainsPattern(normalizedQ);
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where("LOWER(partner.name) LIKE :q ESCAPE E'\\\\'", {
              q: containsPattern,
            })
            .orWhere("LOWER(partner.customerId) LIKE :q ESCAPE E'\\\\'", {
              q: containsPattern,
            })
            .orWhere("LOWER(partner.taxNumber) LIKE :q ESCAPE E'\\\\'", {
              q: containsPattern,
            });
        }),
      );
    }

    const rows = await qb.getMany();
    const hasNext = rows.length > take;
    const content: PartnerOptionDto[] = rows.slice(0, take).map((row) => ({
      id: row.id,
      name: row.name,
      customerId: row.customerId,
      address: row.address,
      city: row.city,
      country: row.country,
      phone: row.phone,
      fax: row.fax,
    }));
    return { content, page, size: take, hasNext };
  }

  async listPartners(query: ListBookingPartnersDto) {
    const normalizedQ = query.q?.trim().toLowerCase() ?? '';
    const { sortColumn, sortOrder } = this.parseSort(query.sort);
    const page = this.sanitizePage(query.page);
    const size = this.sanitizePageSize(query.size);

    const filterQb = () => {
      const qb = this.partnerRepository.createQueryBuilder('partner');
      this.applyFilters(qb, query, normalizedQ);
      return qb;
    };

    const totalElements = await filterQb().getCount();

    const idRows = await filterQb()
      .select('partner.id', 'id')
      .orderBy(sortColumn, sortOrder)
      .offset(page * size)
      .limit(size)
      .getRawMany<{ id: string }>();

    const ids = idRows.map((row) => Number(row.id));
    if (!ids.length) {
      return buildPaginatedResponse<BookingPartnerListItemResponseDto>(
        [],
        totalElements,
        page,
        size,
      );
    }

    const rows = await this.partnerRepository
      .createQueryBuilder('partner')
      .leftJoinAndSelect('partner.additionTypeRows', 'additionTypeRow')
      .where('partner.id IN (:...ids)', { ids })
      .orderBy(sortColumn, sortOrder)
      .getMany();

    const content = rows.map((row) => this.toDetailResponse(row));
    return buildPaginatedResponse(content, totalElements, page, size);
  }

  async getDetail(
    id: number,
    includeArchived = true,
  ): Promise<BookingPartnerDetailResponseDto> {
    const where = includeArchived
      ? { id }
      : {
          id,
          deletedAt: IsNull(),
        };

    const row = await this.partnerRepository.findOne({ where });
    if (!row) {
      throw new NotFoundException('Partner not found');
    }

    return this.toDetailResponse(row);
  }

  async createPartner(
    dto: UpsertBookingPartnerDto,
    actor: string,
    actorUserId?: number,
  ): Promise<BookingPartnerDetailResponseDto> {
    this.validatePartnerInput(dto);

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(BookingPartner);
      const partner = repository.create();

      this.assignUpsertFields(partner, dto);
      partner.customerId = await this.resolveCustomerId(
        manager,
        dto.customerId,
      );
      partner.createdBy = actor;
      partner.updatedBy = actor;

      const saved = await repository.save(partner);
      if (actorUserId != null) {
        await this.fieldChangeService.logFieldChanges(
          saved.id,
          actorUserId,
          BookingPartnerFieldChangeAction.PARTNER_CREATE,
          Object.entries(partnerFieldSnapshot(saved)).map(
            ([field, newValue]) => ({
              field,
              previousValue: null,
              newValue,
            }),
          ),
          manager,
        );
      }
      return this.toDetailResponse(saved);
    });
  }

  /**
   * Create many partners in a SINGLE transaction (used by import). Avoids the
   * per-row transaction + per-row sequence round-trips of {@link createPartner}:
   * duplicate customer ids are checked in one query, all auto ids are reserved
   * in one block, and entities are saved in chunks.
   */
  async createPartnersBulk(
    dtos: UpsertBookingPartnerDto[],
    actor: string,
  ): Promise<{
    successCount: number;
    errorCount: number;
    errors: Array<{ index: number; message: string }>;
  }> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(BookingPartner);

      const providedIds = dtos
        .map((dto) => this.trimToNull(dto.customerId))
        .filter((id): id is string => id != null);

      const existingRows = providedIds.length
        ? await repository.find({
            where: { customerId: In(providedIds) },
            select: { customerId: true },
          })
        : [];
      const takenIds = new Set(existingRows.map((row) => row.customerId));

      const autoCount = dtos.filter(
        (dto) => !this.trimToNull(dto.customerId),
      ).length;
      const autoIds = await this.reserveCustomerIdBlock(manager, autoCount);

      const errors: Array<{ index: number; message: string }> = [];
      const entities: BookingPartner[] = [];
      let autoIndex = 0;

      dtos.forEach((dto, i) => {
        const provided = this.trimToNull(dto.customerId);
        if (provided) {
          if (takenIds.has(provided)) {
            errors.push({
              index: i + 1,
              message: `Customer ID "${provided}" already exists`,
            });
            return;
          }
          takenIds.add(provided);
        }

        const partner = repository.create();
        this.assignUpsertFields(partner, dto);
        partner.customerId = provided ?? autoIds[autoIndex++];
        partner.createdBy = actor;
        partner.updatedBy = actor;
        entities.push(partner);
      });

      if (entities.length) {
        await repository.save(entities, { chunk: 100 });
      }

      return {
        successCount: entities.length,
        errorCount: errors.length,
        errors,
      };
    });
  }

  async updatePartner(
    id: number,
    dto: UpsertBookingPartnerDto,
    actor: string,
    actorUserId?: number,
  ): Promise<BookingPartnerDetailResponseDto> {
    this.validatePartnerInput(dto);

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(BookingPartner);
      const row = await repository.findOne({
        where: {
          id,
          deletedAt: IsNull(),
        },
      });

      if (!row) {
        throw new NotFoundException('Partner not found');
      }

      this.assertPartnerUnlocked(row);
      const before = partnerFieldSnapshot(row);
      this.assignUpsertFields(row, dto);
      row.updatedBy = actor;

      const saved = await saveWithOptimisticLock(
        () => repository.save(row),
        'Partner was modified concurrently; reload and retry',
      );
      if (actorUserId != null) {
        await this.fieldChangeService.logFieldChanges(
          saved.id,
          actorUserId,
          BookingPartnerFieldChangeAction.PARTNER_UPDATE,
          diffPartnerFieldSnapshots(before, partnerFieldSnapshot(saved)),
          manager,
        );
      }
      return this.toDetailResponse(saved);
    });
  }

  async updateCustomerStatus(
    id: number,
    dto: UpdateCustomerStatusDto,
    actor: string,
    actorUserId?: number,
  ): Promise<BookingPartnerDetailResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(BookingPartner);
      const row = await repository.findOne({
        where: {
          id,
          deletedAt: IsNull(),
        },
      });

      if (!row) {
        throw new NotFoundException('Partner not found');
      }

      this.assertPartnerUnlocked(row);
      const before = partnerFieldSnapshot(row);
      row.customerStatus = dto.customerStatus;
      row.updatedBy = actor;

      const saved = await saveWithOptimisticLock(
        () => repository.save(row),
        'Partner was modified concurrently; reload and retry',
      );
      if (actorUserId != null) {
        await this.fieldChangeService.logFieldChanges(
          saved.id,
          actorUserId,
          BookingPartnerFieldChangeAction.PARTNER_UPDATE,
          diffPartnerFieldSnapshots(before, partnerFieldSnapshot(saved)),
          manager,
        );
      }
      return this.toDetailResponse(saved);
    });
  }

  /**
   * Freeze partner edits (EPDA-style). Unlock is not supported.
   * CONC-01: CAS update so only one concurrent lock wins (loser → 409).
   */
  async lockPartner(
    id: number,
    actor: string,
    actorUserId: number,
  ): Promise<BookingPartnerDetailResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(BookingPartner);
      const lockedAt = new Date();
      const result = await repository
        .createQueryBuilder()
        .update(BookingPartner)
        .set({
          lockedAt,
          updatedBy: actor,
          version: () => '"version" + 1',
        })
        .where('id = :id', { id })
        .andWhere('deleted_at IS NULL')
        .andWhere('locked_at IS NULL')
        .execute();

      if (result.affected !== 1) {
        const row = await repository.findOne({
          where: { id, deletedAt: IsNull() },
        });
        if (!row) {
          throw new NotFoundException('Partner not found');
        }
        if (row.lockedAt) {
          throw new ConflictException('Partner is already locked');
        }
        throw new ConflictException(
          'Partner was modified concurrently; reload and retry',
        );
      }

      const saved = await repository.findOne({
        where: { id, deletedAt: IsNull() },
      });
      if (!saved) {
        throw new NotFoundException('Partner not found');
      }

      await this.fieldChangeService.logFieldChanges(
        saved.id,
        actorUserId,
        BookingPartnerFieldChangeAction.PARTNER_LOCK,
        [
          {
            field: 'Partner locked',
            previousValue: null,
            newValue: saved.lockedAt ? String(saved.lockedAt) : null,
          },
        ],
        manager,
      );
      return this.toDetailResponse(saved);
    });
  }

  async listFieldChangeLogs(partnerId: number, page = 0, size = 6) {
    await this.getDetail(partnerId, true);
    return this.fieldChangeService.listForPartner(partnerId, page, size);
  }

  async delete(id: number): Promise<void> {
    const row = await this.partnerRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Partner not found');
    }

    await this.assertNoDocumentReferences(this.dataSource, id);
    await this.partnerRepository.remove(row);
  }

  /**
   * Wipe ALL partners (and their FK-dependent rows: shipping, addition types)
   * so a fresh dataset can be imported. TRUNCATE ... CASCADE clears dependent
   * tables regardless of their FK onDelete config, and resets identities.
   */
  async deleteAll(expectedCount: number): Promise<{ deleted: number }> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'seatrans:booking-partners:delete-all',
      ]);
      const countRows = await manager.query<Array<{ count: number | string }>>(
        'SELECT count(*)::integer AS count FROM booking_partners',
      );
      const deleted = Number(countRows[0]?.count ?? 0);
      if (deleted !== expectedCount) {
        throw new ConflictException(
          `Partner count changed: expected ${expectedCount}, found ${deleted}`,
        );
      }

      await this.assertNoDocumentReferences(manager);
      await manager.query(
        'TRUNCATE TABLE booking_partners RESTART IDENTITY CASCADE',
      );
      return { deleted };
    });
  }

  private async assertNoDocumentReferences(
    executor: Pick<DataSource | EntityManager, 'query'>,
    partnerId?: number,
  ): Promise<void> {
    // ponytail: JSON ids cannot be protected by a database FK. This check is
    // intentionally the smallest guard; normalize party refs if concurrent
    // partner deletion/document creation becomes a real workload.
    const rows = await executor.query<Array<{ isReferenced: boolean }>>(
      `SELECT EXISTS (
        SELECT 1 FROM booking_records
        WHERE NULLIF(payload ->> 'clientPartyId', '') IS NOT NULL
          AND ($1::text IS NULL OR payload ->> 'clientPartyId' = $1::text)
        UNION ALL
        SELECT 1 FROM arrival_notice_records
        WHERE COALESCE(
          NULLIF(payload ->> 'agentPartyId', ''),
          NULLIF(payload ->> 'shipperPartyId', ''),
          NULLIF(payload ->> 'consigneePartyId', ''),
          NULLIF(payload ->> 'notifyPartyId', '')
        ) IS NOT NULL
          AND ($1::text IS NULL OR $1::text IN (
            payload ->> 'agentPartyId', payload ->> 'shipperPartyId',
            payload ->> 'consigneePartyId', payload ->> 'notifyPartyId'
          ))
        UNION ALL
        SELECT 1 FROM bill_of_lading_records
        WHERE COALESCE(
          NULLIF(payload ->> 'shipperPartyId', ''),
          NULLIF(payload ->> 'consigneePartyId', ''),
          NULLIF(payload ->> 'notifyPartyId', '')
        ) IS NOT NULL
          AND ($1::text IS NULL OR $1::text IN (
            payload ->> 'shipperPartyId', payload ->> 'consigneePartyId',
            payload ->> 'notifyPartyId'
          ))
        UNION ALL
        SELECT 1 FROM delivery_order_records
        WHERE COALESCE(
          NULLIF(payload ->> 'consigneePartyId', ''),
          NULLIF(payload ->> 'notifyPartyId', '')
        ) IS NOT NULL
          AND ($1::text IS NULL OR $1::text IN (
            payload ->> 'consigneePartyId', payload ->> 'notifyPartyId'
          ))
      ) AS "isReferenced"`,
      [partnerId == null ? null : String(partnerId)],
    );
    if (rows[0]?.isReferenced) {
      throw new ConflictException(
        'Partner is referenced by a booking document and cannot be deleted',
      );
    }
  }

  private applyFilters(
    qb: SelectQueryBuilder<BookingPartner>,
    query: ListBookingPartnersDto,
    normalizedQ: string,
  ): void {
    if (query.includeArchived) {
      qb.where('partner.deletedAt IS NOT NULL');
    } else {
      qb.where('partner.deletedAt IS NULL');
    }

    if (query.customerStatus) {
      qb.andWhere('partner.customerStatus = :customerStatus', {
        customerStatus: query.customerStatus,
      });
    }

    if (query.customerType) {
      qb.andWhere('partner.customerType = :customerType', {
        customerType: query.customerType,
      });
    }

    if (normalizedQ) {
      const containsPattern = buildPartnerContainsPattern(normalizedQ);
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where("LOWER(partner.name) LIKE :q ESCAPE E'\\\\'", {
              q: containsPattern,
            })
            .orWhere("LOWER(partner.customerId) LIKE :q ESCAPE E'\\\\'", {
              q: containsPattern,
            })
            .orWhere("LOWER(partner.taxNumber) LIKE :q ESCAPE E'\\\\'", {
              q: containsPattern,
            });
        }),
      );
    }

    const additionTypes = query.additionTypes ?? [];
    if (!additionTypes.length) {
      return;
    }

    if (query.additionTypesMode === 'AND') {
      qb.andWhere(
        `(SELECT COUNT(DISTINCT bpat.addition_type)
          FROM booking_partner_addition_types bpat
          WHERE bpat.partner_id = partner.id
          AND bpat.addition_type IN (:...additionTypes)) = :additionCount`,
        {
          additionTypes,
          additionCount: additionTypes.length,
        },
      );
      return;
    }

    qb.andWhere(
      `EXISTS (
        SELECT 1 FROM booking_partner_addition_types bpat
        WHERE bpat.partner_id = partner.id
        AND bpat.addition_type IN (:...additionTypes)
      )`,
      { additionTypes },
    );
  }

  private parseSort(sort?: string): {
    sortColumn: string;
    sortOrder: 'ASC' | 'DESC';
  } {
    const sortMap: Record<string, string> = {
      id: 'partner.id',
      customerId: 'partner.customerId',
      name: 'partner.name',
      createdAt: 'partner.createdAt',
      updatedAt: 'partner.updatedAt',
    };

    const [fieldRaw, directionRaw] = (sort ?? 'updatedAt,desc').split(',');
    const field = fieldRaw?.trim() ?? 'updatedAt';
    const sortColumn = sortMap[field] ?? sortMap.updatedAt;
    const sortOrder =
      directionRaw?.trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    return { sortColumn, sortOrder };
  }

  private assignUpsertFields(
    partner: BookingPartner,
    dto: UpsertBookingPartnerDto,
  ): void {
    const additionTypes = Array.from(new Set(dto.additionTypes ?? []));

    partner.name = this.trimToNull(dto.name) ?? '';
    partner.additionTypeRows = additionTypes.map((additionType) =>
      this.toAdditionTypeRow(partner, additionType),
    );

    partner.country = this.trimToNull(dto.country);
    partner.city = this.trimToNull(dto.city);
    partner.contacts = this.normalizeContacts(dto.contacts);
    partner.phone = this.trimToNull(dto.phone);
    partner.fax = this.trimToNull(dto.fax);
    partner.trackingUrl = this.trimToNull(dto.trackingUrl);
    partner.address = this.trimToNull(dto.address);
    partner.customerStatus = dto.customerStatus ?? null;
    partner.customerType = dto.customerType ?? null;
    partner.approveStatus = dto.approveStatus ?? null;
    partner.approveBy = this.trimToNull(dto.approveBy);
    partner.companyEstablishmentDate = this.trimToNull(
      dto.companyEstablishmentDate,
    );
    partner.paymentDueDays = dto.paymentDueDays ?? null;
    partner.contractNo = this.trimToNull(dto.contractNo);
    partner.taxNumber = this.trimToNull(dto.taxNumber);
    partner.invoiceCompanyName = this.trimToNull(dto.invoiceCompanyName);
    partner.invoiceCompanyAddress = this.trimToNull(dto.invoiceCompanyAddress);
    partner.invoiceCompanyPhone = this.trimToNull(dto.invoiceCompanyPhone);
    partner.invoiceCompanyEmail = this.trimToNull(dto.invoiceCompanyEmail);
    partner.invoiceBankName = this.trimToNull(dto.invoiceBankName);
    partner.invoiceBankBranch = this.trimToNull(dto.invoiceBankBranch);
    partner.invoiceBankAccount = this.trimToNull(dto.invoiceBankAccount);
  }

  /** Trim each contact field and drop contacts that are entirely empty. */
  private normalizeContacts(contacts?: PartnerContactDto[]): PartnerContact[] {
    if (!contacts?.length) return [];
    return contacts
      .map((c) => ({
        person: this.trimToNull(c.person),
        firstName: this.trimToNull(c.firstName),
        lastName: this.trimToNull(c.lastName),
        email: this.trimToNull(c.email),
        phone: this.trimToNull(c.phone),
        title: this.trimToNull(c.title),
        dateOfBirth: this.trimToNull(c.dateOfBirth),
      }))
      .filter((c) => Object.values(c).some((v) => v != null));
  }

  private toAdditionTypeRow(
    partner: BookingPartner,
    additionType: PartnerAdditionType,
  ): BookingPartnerAdditionTypeEntity {
    const row = new BookingPartnerAdditionTypeEntity();
    row.partner = partner;
    row.additionType = additionType;
    return row;
  }

  private toDetailResponse(
    partner: BookingPartner,
  ): BookingPartnerDetailResponseDto {
    return {
      id: partner.id,
      customerId: partner.customerId,
      name: partner.name,
      additionTypes: (partner.additionTypeRows ?? []).map(
        (row) => row.additionType,
      ),
      country: partner.country,
      city: partner.city,
      contacts: partner.contacts ?? [],
      phone: partner.phone,
      fax: partner.fax,
      trackingUrl: partner.trackingUrl,
      address: partner.address,
      customerStatus: partner.customerStatus,
      customerType: partner.customerType,
      approveStatus: partner.approveStatus,
      approveBy: partner.approveBy,
      companyEstablishmentDate: partner.companyEstablishmentDate,
      paymentDueDays: partner.paymentDueDays,
      contractNo: partner.contractNo,
      taxNumber: partner.taxNumber,
      invoiceCompanyName: partner.invoiceCompanyName,
      invoiceCompanyAddress: partner.invoiceCompanyAddress,
      invoiceCompanyPhone: partner.invoiceCompanyPhone,
      invoiceCompanyEmail: partner.invoiceCompanyEmail,
      invoiceBankName: partner.invoiceBankName,
      invoiceBankBranch: partner.invoiceBankBranch,
      invoiceBankAccount: partner.invoiceBankAccount,
      createdBy: partner.createdBy,
      createdAt: partner.createdAt,
      updatedBy: partner.updatedBy,
      updatedAt: partner.updatedAt,
      deletedAt: partner.deletedAt,
      lockedAt: partner.lockedAt,
      version: Number(partner.version ?? 1),
    };
  }

  private assertPartnerUnlocked(row: BookingPartner): void {
    if (row.lockedAt) {
      throw new ConflictException(
        'Partner is locked. Unlock is not supported — create a new partner to change fields.',
      );
    }
  }

  private validatePartnerInput(dto: UpsertBookingPartnerDto): void {
    if (!this.trimToNull(dto.name)) {
      throw new BadRequestException('name is required');
    }
    // additionTypes is optional: a partner may have zero or many.
  }

  private sanitizePage(page?: number): number {
    if (!Number.isFinite(page) || page == null || page < 0) {
      return 0;
    }
    return page;
  }

  private sanitizePageSize(size?: number): number {
    if (!Number.isFinite(size) || size == null || size <= 0) {
      return BookingPartnerService.DEFAULT_PAGE_SIZE;
    }
    return Math.min(size, BookingPartnerService.MAX_PAGE_SIZE);
  }

  private sanitizeOptionsLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) {
      return BookingPartnerService.DEFAULT_OPTIONS_LIMIT;
    }
    return Math.min(limit, BookingPartnerService.MAX_OPTIONS_LIMIT);
  }

  private trimToNull(value?: string | null): string | null {
    if (value == null) {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  /**
   * Preserve a customer id supplied on create (e.g. legacy migration / import),
   * enforcing uniqueness; otherwise auto-generate a fresh one.
   */
  private async resolveCustomerId(
    manager: EntityManager,
    requested?: string | null,
  ): Promise<string> {
    const provided = this.trimToNull(requested);
    if (!provided) {
      return this.generateCustomerId(manager);
    }

    const existing = await manager.findOne(BookingPartner, {
      where: { customerId: provided },
    });
    if (existing) {
      throw new BadRequestException(`Customer ID "${provided}" already exists`);
    }

    return provided;
  }

  private currentDatePart(): string {
    const date = new Date();
    const yy = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yy}${mm}${dd}`;
  }

  private async generateCustomerId(manager: EntityManager): Promise<string> {
    const [id] = await this.reserveCustomerIdBlock(manager, 1);
    return id;
  }

  /**
   * Atomically reserve a contiguous block of `count` customer ids for today,
   * returning the formatted ids. One UPDATE ... RETURNING bumps the sequence by
   * the whole block, so bulk import does not pay a round-trip per row.
   */
  private async reserveCustomerIdBlock(
    manager: EntityManager,
    count: number,
  ): Promise<string[]> {
    if (count <= 0) return [];
    const datePart = this.currentDatePart();

    await manager.query(
      'INSERT INTO customer_id_sequences(sequence_date, current_value) VALUES ($1, 0) ON CONFLICT (sequence_date) DO NOTHING',
      [datePart],
    );

    const rows = await manager.query<Array<{ current_value: number | string }>>(
      'UPDATE customer_id_sequences SET current_value = current_value + $1 WHERE sequence_date = $2 RETURNING current_value',
      [count, datePart],
    );

    if (!rows.length) {
      throw new BadRequestException('Failed to reserve customer id sequence');
    }

    const end = Number(rows[0].current_value);
    const start = end - count + 1;
    const ids: string[] = [];
    for (let value = start; value <= end; value++) {
      ids.push(`CUS-${datePart}-${String(value).padStart(6, '0')}`);
    }
    return ids;
  }
}
