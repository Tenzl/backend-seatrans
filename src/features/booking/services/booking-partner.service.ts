import {
  BadRequestException,
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
import { PartnerOptionDto } from '../dto/partner-option.dto';
import { PartnerAdditionType } from '../enums/partner-addition-type.enum';
import { UpdateCustomerStatusDto } from '../dto/update-customer-status.dto';

@Injectable()
export class BookingPartnerService {
  private static readonly DEFAULT_PAGE_SIZE = 20;
  private static readonly MAX_PAGE_SIZE = 100;
  private static readonly DEFAULT_OPTIONS_LIMIT = 30;
  private static readonly MAX_OPTIONS_LIMIT = 50;
  private sequenceTableEnsured = false;

  constructor(
    @InjectRepository(BookingPartner)
    private readonly partnerRepository: Repository<BookingPartner>,
    private readonly dataSource: DataSource,
  ) {}

  async listPartnerOptions(q?: string, limit?: number): Promise<PartnerOptionDto[]> {
    const normalizedQ = q?.trim().toLowerCase() ?? '';
    const take = this.sanitizeOptionsLimit(limit ?? BookingPartnerService.DEFAULT_OPTIONS_LIMIT);

    const qb = this.partnerRepository
      .createQueryBuilder('partner')
      .select(['partner.id', 'partner.name', 'partner.customerId'])
      .where('partner.deletedAt IS NULL')
      .orderBy('partner.name', 'ASC')
      .take(take);

    if (normalizedQ.length > 0) {
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('LOWER(partner.name) LIKE :q', { q: `%${normalizedQ}%` })
            .orWhere('LOWER(partner.customerId) LIKE :q', { q: `%${normalizedQ}%` });
        }),
      );
    }

    const rows = await qb.getMany();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      customerId: row.customerId,
    }));
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

  async getDetail(id: number, includeArchived = true): Promise<BookingPartnerDetailResponseDto> {
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
  ): Promise<BookingPartnerDetailResponseDto> {
    this.validatePartnerInput(dto);

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(BookingPartner);
      const partner = repository.create();

      this.assignUpsertFields(partner, dto);
      partner.customerId = await this.resolveCustomerId(manager, dto.customerId);
      partner.createdBy = actor;
      partner.updatedBy = actor;

      const saved = await repository.save(partner);
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

      const autoCount = dtos.filter((dto) => !this.trimToNull(dto.customerId)).length;
      const autoIds = await this.reserveCustomerIdBlock(manager, autoCount);

      const errors: Array<{ index: number; message: string }> = [];
      const entities: BookingPartner[] = [];
      let autoIndex = 0;

      dtos.forEach((dto, i) => {
        const provided = this.trimToNull(dto.customerId);
        if (provided) {
          if (takenIds.has(provided)) {
            errors.push({ index: i + 1, message: `Customer ID "${provided}" already exists` });
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

      return { successCount: entities.length, errorCount: errors.length, errors };
    });
  }

  async updatePartner(
    id: number,
    dto: UpsertBookingPartnerDto,
    actor: string,
  ): Promise<BookingPartnerDetailResponseDto> {
    this.validatePartnerInput(dto);

    const row = await this.partnerRepository.findOne({
      where: {
        id,
        deletedAt: IsNull(),
      },
    });

    if (!row) {
      throw new NotFoundException('Partner not found');
    }

    this.assignUpsertFields(row, dto);
    row.updatedBy = actor;

    const saved = await this.partnerRepository.save(row);
    return this.toDetailResponse(saved);
  }

  async updateCustomerStatus(
    id: number,
    dto: UpdateCustomerStatusDto,
    actor: string,
  ): Promise<BookingPartnerDetailResponseDto> {
    const row = await this.partnerRepository.findOne({
      where: {
        id,
        deletedAt: IsNull(),
      },
    });

    if (!row) {
      throw new NotFoundException('Partner not found');
    }

    row.customerStatus = dto.customerStatus;
    row.updatedBy = actor;

    const saved = await this.partnerRepository.save(row);
    return this.toDetailResponse(saved);
  }

  async delete(id: number): Promise<void> {
    const row = await this.partnerRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Partner not found');
    }

    await this.partnerRepository.remove(row);
  }

  /**
   * Wipe ALL partners (and their FK-dependent rows: shipping, addition types)
   * so a fresh dataset can be imported. TRUNCATE ... CASCADE clears dependent
   * tables regardless of their FK onDelete config, and resets identities.
   */
  async deleteAll(): Promise<{ deleted: number }> {
    const deleted = await this.partnerRepository.count();
    await this.dataSource.query(
      'TRUNCATE TABLE booking_partners RESTART IDENTITY CASCADE',
    );
    return { deleted };
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
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where('LOWER(partner.name) LIKE :q', { q: `%${normalizedQ}%` })
            .orWhere('LOWER(partner.customerId) LIKE :q', { q: `%${normalizedQ}%` })
            .orWhere('LOWER(partner.taxNumber) LIKE :q', { q: `%${normalizedQ}%` });
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
    const sortOrder = directionRaw?.trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    return { sortColumn, sortOrder };
  }

  private assignUpsertFields(partner: BookingPartner, dto: UpsertBookingPartnerDto): void {
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
    partner.companyEstablishmentDate = this.trimToNull(dto.companyEstablishmentDate);
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

  private toDetailResponse(partner: BookingPartner): BookingPartnerDetailResponseDto {
    return {
      id: partner.id,
      customerId: partner.customerId,
      name: partner.name,
      additionTypes: (partner.additionTypeRows ?? []).map((row) => row.additionType),
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
    };
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
    await this.ensureSequenceTable(manager);

    const datePart = this.currentDatePart();

    await manager.query(
      'INSERT INTO customer_id_sequences(sequence_date, current_value) VALUES ($1, 0) ON CONFLICT (sequence_date) DO NOTHING',
      [datePart],
    );

    const rows = await manager.query(
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

  private async ensureSequenceTable(manager: EntityManager): Promise<void> {
    if (this.sequenceTableEnsured) {
      return;
    }

    await manager.query(`
      CREATE TABLE IF NOT EXISTS customer_id_sequences (
        sequence_date CHAR(6) PRIMARY KEY,
        current_value BIGINT NOT NULL
      )
    `);

    this.sequenceTableEnsured = true;
  }
}
