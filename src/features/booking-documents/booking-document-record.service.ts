import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DeepPartial,
  EntityManager,
  ILike,
  In,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { saveWithOptimisticLock } from '../../shared/utils/optimistic-lock';
import { BookingDocumentPayload } from './booking-document.types';
import { missingRequiredDocumentFields } from './booking-document-requirements';
import { ArrivalNoticePreviewDto } from './dto/arrival-notice-preview.dto';
import { BillOfLadingPreviewDto } from './dto/bill-of-lading-preview.dto';
import { BookingConfirmationPreviewDto } from './dto/booking-confirmation-preview.dto';
import { DeliveryOrderPreviewDto } from './dto/delivery-order-preview.dto';
import { ArrivalNoticeRecord } from './entities/arrival-notice-record.entity';
import { BillOfLadingRecord } from './entities/bill-of-lading-record.entity';
import { BookingDocumentRecordBase } from './entities/booking-document-record-base.entity';
import { BookingRecord } from './entities/booking-record.entity';
import { DeliveryOrderRecord } from './entities/delivery-order-record.entity';
import { BookingDocumentStatus } from './enums/booking-document-status.enum';
import { BookingDocumentType } from './enums/booking-document-type.enum';
import { BookingFlow } from './enums/booking-flow.enum';
import {
  nonBlankCargoVolumes,
  nonBlankContainers,
  parseReportNumber,
  projectRelationalFields,
} from './booking-document-relational-projector';

const WORKFLOW_TYPES: Record<BookingFlow, BookingDocumentType[]> = {
  [BookingFlow.EXPORT]: [
    BookingDocumentType.BOOKING_CONFIRMATION,
    BookingDocumentType.BILL_OF_LADING,
  ],
  [BookingFlow.IMPORT]: [
    BookingDocumentType.BOOKING_CONFIRMATION,
    BookingDocumentType.ARRIVAL_NOTICE,
    BookingDocumentType.DELIVERY_ORDER,
  ],
};

type ChildRecord =
  ArrivalNoticeRecord | DeliveryOrderRecord | BillOfLadingRecord;
type DocumentRecord = BookingRecord | ChildRecord;
type WorkflowFields = {
  bookingFlow?: BookingFlow;
  bookingId?: number;
};

const PRIMARY_NUMBER_FIELDS: Record<
  BookingDocumentType,
  { alias: string; databaseColumn: string; payloadField: string }
> = {
  [BookingDocumentType.BOOKING_CONFIRMATION]: {
    alias: 'booking',
    databaseColumn: 'booking_number',
    payloadField: 'bookingNumber',
  },
  [BookingDocumentType.ARRIVAL_NOTICE]: {
    alias: 'an',
    databaseColumn: 'an_number',
    payloadField: 'anNumber',
  },
  [BookingDocumentType.DELIVERY_ORDER]: {
    alias: 'deliveryOrder',
    databaseColumn: 'do_number',
    payloadField: 'doNumber',
  },
  [BookingDocumentType.BILL_OF_LADING]: {
    alias: 'bl',
    databaseColumn: 'fbl_number',
    payloadField: 'fblNumber',
  },
};

type DocumentNumberMatch = {
  id: number;
  documentType: BookingDocumentType;
  bookingId: number | null;
  bookingNumber: string | null;
  number: string;
  createdAt: string;
};

@Injectable()
export class BookingDocumentRecordService {
  constructor(
    @InjectRepository(BookingRecord)
    private readonly bookingRepository: Repository<BookingRecord>,
    @InjectRepository(ArrivalNoticeRecord)
    private readonly arrivalNoticeRepository: Repository<ArrivalNoticeRecord>,
    @InjectRepository(DeliveryOrderRecord)
    private readonly deliveryOrderRepository: Repository<DeliveryOrderRecord>,
    @InjectRepository(BillOfLadingRecord)
    private readonly billOfLadingRepository: Repository<BillOfLadingRecord>,
  ) {}

  async create(
    type: BookingDocumentType,
    payload: BookingDocumentPayload,
    createdByUserId: number,
    workflow: WorkflowFields = {},
    manager?: EntityManager,
  ) {
    const workflowFields = await this.resolveWorkflowFields(
      type,
      workflow,
      manager,
    );
    const snapshot = this.clonePayload(payload);
    const repository = this.repository(type, manager);
    const record = repository.create({
      payload: snapshot,
      ...projectRelationalFields(type, snapshot),
      status: this.statusFor(type, snapshot),
      createdByUserId,
      updatedByUserId: createdByUserId,
      ...workflowFields,
    } as DeepPartial<BookingDocumentRecordBase>);

    try {
      const saved = await saveWithOptimisticLock(
        () => repository.save(record),
        'Document record was modified concurrently; reload and retry',
      );
      if (manager)
        await this.syncRepeatedRows(type, Number(saved.id), snapshot, manager);
      return this.toResponse(type, saved);
    } catch (error) {
      const databaseCode = (error as { driverError?: { code?: string } } | null)
        ?.driverError?.code;
      if (workflow.bookingId && databaseCode === '23505') {
        throw new ConflictException(
          'This booking already has an active document of that type',
        );
      }
      throw error;
    }
  }

  async getById(
    type: BookingDocumentType,
    id: number,
    manager?: EntityManager,
  ) {
    const record = await this.findActiveOrFail(type, id, true, manager);
    return this.toResponse(type, record);
  }

  /** Active child document for a booking, or null when none exists. */
  async findActiveByBookingId(
    type: BookingDocumentType,
    bookingId: number,
    manager?: EntityManager,
  ) {
    if (type === BookingDocumentType.BOOKING_CONFIRMATION) {
      return this.getById(type, bookingId, manager);
    }
    const record = await this.repository(type, manager).findOne({
      where: { bookingId, deletedAt: IsNull() } as never,
    });
    return record ? this.toResponse(type, record) : null;
  }

  async getWorkflow(bookingId: number) {
    const booking = (await this.findActiveOrFail(
      BookingDocumentType.BOOKING_CONFIRMATION,
      bookingId,
      true,
    )) as BookingRecord;

    const childTypes = [
      BookingDocumentType.ARRIVAL_NOTICE,
      BookingDocumentType.BILL_OF_LADING,
      BookingDocumentType.DELIVERY_ORDER,
    ] as const;
    const childGroups = await Promise.all(
      childTypes.map(async (type) => ({
        type,
        records: await this.repository(type).find({
          where: { bookingId, deletedAt: IsNull() } as never,
          relations: { createdBy: true },
          order: { createdAt: 'ASC', id: 'ASC' },
        }),
      })),
    );

    const documents: Partial<
      Record<BookingDocumentType, ReturnType<typeof this.toResponse>>
    > = {
      [BookingDocumentType.BOOKING_CONFIRMATION]: this.toResponse(
        BookingDocumentType.BOOKING_CONFIRMATION,
        booking,
      ),
    };
    for (const group of childGroups) {
      for (const record of group.records) {
        documents[group.type] = this.toResponse(group.type, record);
      }
    }

    return {
      id: Number(booking.id),
      flow: booking.bookingFlow,
      status: this.workflowStatusFor(booking.bookingFlow, documents),
      documents,
    };
  }

  async getBookingCopySource(bookingId: number) {
    const booking = (await this.findActiveOrFail(
      BookingDocumentType.BOOKING_CONFIRMATION,
      bookingId,
      false,
    )) as BookingRecord;

    return {
      sourceBookingId: Number(booking.id),
      bookingFlow: booking.bookingFlow,
      payload: this.clonePayload(booking.payload),
    };
  }

  async findBillOfLadingNumberDuplicates(number: string, excludeId?: number) {
    return this.findPrimaryNumberDuplicates(
      BookingDocumentType.BILL_OF_LADING,
      number,
      excludeId,
    );
  }

  async findDocumentNumberDuplicates(
    currentType: BookingDocumentType,
    number: string,
    excludeId?: number,
  ): Promise<DocumentNumberMatch[]> {
    const matchGroups = await Promise.all(
      Object.values(BookingDocumentType).map((type) =>
        this.findPrimaryNumberDuplicates(
          type,
          number,
          type === currentType ? excludeId : undefined,
        ),
      ),
    );

    return matchGroups
      .flat()
      .sort((left, right) => {
        const createdDifference =
          Date.parse(right.createdAt) - Date.parse(left.createdAt);
        return createdDifference || right.id - left.id;
      })
      .slice(0, 10);
  }

  async update(
    type: BookingDocumentType,
    id: number,
    payload: BookingDocumentPayload,
    actorUserId: number,
    expectedVersion: number,
    manager?: EntityManager,
  ) {
    const record = await this.findActiveOrFail(type, id, false, manager);
    await this.assertMutable(type, record, manager);
    const snapshot = this.clonePayload(payload);
    return this.casUpdate(
      type,
      record,
      expectedVersion,
      {
        payload: snapshot,
        ...projectRelationalFields(type, snapshot),
        status: this.statusFor(type, snapshot),
        updatedByUserId: actorUserId,
      },
      manager,
      'locked_at IS NULL',
    );
  }

  async lock(
    type: BookingDocumentType,
    id: number,
    actorUserId: number,
    expectedVersion: number,
    manager?: EntityManager,
  ) {
    const record = await this.findActiveOrFail(type, id, false, manager);
    if (record.lockedAt) {
      throw new ConflictException('Document record is already locked');
    }
    const missing = this.missingRequiredFields(type, record.payload);
    if (missing.length > 0) {
      throw new ConflictException(
        `Document is incomplete; missing: ${missing.join(', ')}`,
      );
    }
    return this.casUpdate(
      type,
      record,
      expectedVersion,
      {
        lockedAt: new Date(),
        status: BookingDocumentStatus.COMPLETED,
        updatedByUserId: actorUserId,
      },
      manager,
      'locked_at IS NULL',
    );
  }

  async unlock(
    type: BookingDocumentType,
    id: number,
    actorUserId: number,
    expectedVersion: number,
    manager?: EntityManager,
  ) {
    const record = await this.findActiveOrFail(type, id, false, manager);
    if (!record.lockedAt) {
      throw new ConflictException('Document record is not locked');
    }
    return this.casUpdate(
      type,
      record,
      expectedVersion,
      {
        lockedAt: null,
        updatedByUserId: actorUserId,
      },
      manager,
      'locked_at IS NOT NULL',
    );
  }

  async hardDelete(
    type: BookingDocumentType,
    id: number,
    manager?: EntityManager,
  ): Promise<void> {
    const repository = this.repository(type, manager);
    const record = (await repository.findOne({
      where: { id, deletedAt: IsNull() },
    })) as DocumentRecord | null;
    if (!record) throw new NotFoundException('Document record not found');
    await this.assertDeletable(type, record, manager);
    await repository.remove(record);
  }

  async list(type: BookingDocumentType, page = 0, size = 10, bookingNo = '') {
    const safePage = Math.max(0, page);
    const safeSize = Math.min(50, Math.max(1, size));
    const normalizedBookingNo = bookingNo.trim();
    const where =
      type === BookingDocumentType.BOOKING_CONFIRMATION && normalizedBookingNo
        ? {
            deletedAt: IsNull(),
            bookingNumber: ILike(`%${normalizedBookingNo}%`),
          }
        : { deletedAt: IsNull() };
    const [records, totalElements] = await this.repository(type).findAndCount({
      where,
      relations: { createdBy: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: safePage * safeSize,
      take: safeSize,
    });

    const workflowStatuses =
      type === BookingDocumentType.BOOKING_CONFIRMATION
        ? await this.workflowStatusesForBookings(records as BookingRecord[])
        : new Map<number, BookingDocumentStatus>();

    return {
      content: records.map((record) =>
        this.toResponse(type, record, workflowStatuses.get(Number(record.id))),
      ),
      totalElements,
      totalPages: totalElements === 0 ? 0 : Math.ceil(totalElements / safeSize),
      size: safeSize,
      number: safePage,
    };
  }

  private async findPrimaryNumberDuplicates(
    type: BookingDocumentType,
    number: string,
    excludeId?: number,
  ): Promise<DocumentNumberMatch[]> {
    const normalizedNumber = number.trim();
    if (!normalizedNumber) return [];

    const { alias, databaseColumn, payloadField } = PRIMARY_NUMBER_FIELDS[type];
    let query = this.repository(type)
      .createQueryBuilder(alias)
      .where(
        `LOWER(BTRIM(${alias}.${databaseColumn})) = LOWER(BTRIM(:number))`,
        { number: normalizedNumber },
      )
      .andWhere(`${alias}.deleted_at IS NULL`);
    if (type !== BookingDocumentType.BOOKING_CONFIRMATION) {
      query = query.leftJoinAndSelect(`${alias}.booking`, 'booking');
    }
    if (excludeId != null) {
      query = query.andWhere(`${alias}.id <> :excludeId`, { excludeId });
    }

    const records = await query
      .orderBy(`${alias}.createdAt`, 'DESC')
      .addOrderBy(`${alias}.id`, 'DESC')
      .take(10)
      .getMany();

    return records.map((record) => {
      const child = record as ChildRecord;
      const bookingNumber =
        type === BookingDocumentType.BOOKING_CONFIRMATION
          ? this.payloadText(record, 'bookingNumber')
          : child.booking?.bookingNumber?.trim() || null;
      const bookingId =
        type === BookingDocumentType.BOOKING_CONFIRMATION
          ? Number(record.id)
          : child.bookingId == null
            ? null
            : Number(child.bookingId);

      return {
        id: Number(record.id),
        documentType: type,
        bookingId,
        bookingNumber,
        number: this.payloadText(record, payloadField) ?? normalizedNumber,
        createdAt: record.createdAt.toISOString(),
      };
    });
  }

  private payloadText(
    record: BookingDocumentRecordBase,
    field: string,
  ): string | null {
    const value = record.payload[field];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private repository(
    type: BookingDocumentType,
    manager?: EntityManager,
  ): Repository<BookingDocumentRecordBase> {
    if (manager) {
      switch (type) {
        case BookingDocumentType.BOOKING_CONFIRMATION:
          return manager.getRepository(BookingRecord);
        case BookingDocumentType.ARRIVAL_NOTICE:
          return manager.getRepository(ArrivalNoticeRecord);
        case BookingDocumentType.DELIVERY_ORDER:
          return manager.getRepository(DeliveryOrderRecord);
        case BookingDocumentType.BILL_OF_LADING:
          return manager.getRepository(BillOfLadingRecord);
      }
    }
    switch (type) {
      case BookingDocumentType.BOOKING_CONFIRMATION:
        return this.bookingRepository;
      case BookingDocumentType.ARRIVAL_NOTICE:
        return this.arrivalNoticeRepository;
      case BookingDocumentType.DELIVERY_ORDER:
        return this.deliveryOrderRepository;
      case BookingDocumentType.BILL_OF_LADING:
        return this.billOfLadingRepository;
    }
  }

  private async findActiveOrFail(
    type: BookingDocumentType,
    id: number,
    withCreator = false,
    manager?: EntityManager,
  ): Promise<DocumentRecord> {
    const record = await this.repository(type, manager).findOne({
      where: { id, deletedAt: IsNull() },
      relations: withCreator ? { createdBy: true } : undefined,
    });
    if (!record) throw new NotFoundException('Document record not found');
    return record as DocumentRecord;
  }

  private async assertDeletable(
    type: BookingDocumentType,
    record: DocumentRecord,
    manager?: EntityManager,
  ): Promise<void> {
    if (record.lockedAt) {
      throw new ConflictException(
        'Locked document records cannot be deleted; an administrator must unlock edit first',
      );
    }

    if (type === BookingDocumentType.BOOKING_CONFIRMATION) {
      const childTypes = [
        BookingDocumentType.ARRIVAL_NOTICE,
        BookingDocumentType.DELIVERY_ORDER,
        BookingDocumentType.BILL_OF_LADING,
      ];
      const lockedChildren = await Promise.all(
        childTypes.map((childType) =>
          this.repository(childType, manager).findOne({
            where: {
              bookingId: Number(record.id),
              lockedAt: Not(IsNull()),
              deletedAt: IsNull(),
            } as never,
          }),
        ),
      );
      if (lockedChildren.some(Boolean)) {
        throw new ConflictException(
          'Booking workflow contains a locked document and cannot be deleted; an administrator must unlock edit first',
        );
      }
      return;
    }

    const bookingId = (record as ChildRecord).bookingId;
    if (!bookingId) return;
    const booking = await this.findActiveOrFail(
      BookingDocumentType.BOOKING_CONFIRMATION,
      bookingId,
      false,
      manager,
    );
    if (booking.lockedAt) {
      throw new ConflictException(
        'Locked booking workflows cannot be deleted; an administrator must unlock edit first',
      );
    }
  }

  private async assertMutable(
    type: BookingDocumentType,
    record: DocumentRecord,
    manager?: EntityManager,
  ) {
    if (record.lockedAt) {
      throw new ConflictException(
        'Document record is locked and cannot be edited',
      );
    }
    if (type !== BookingDocumentType.BOOKING_CONFIRMATION) {
      const bookingId = (record as ChildRecord).bookingId;
      if (bookingId) {
        const booking = await this.findActiveOrFail(
          BookingDocumentType.BOOKING_CONFIRMATION,
          bookingId,
          false,
          manager,
        );
        if (booking.lockedAt) {
          throw new ConflictException(
            'Booking workflow is locked and cannot be edited',
          );
        }
      }
    }
  }

  private async resolveWorkflowFields(
    type: BookingDocumentType,
    workflow: WorkflowFields,
    manager?: EntityManager,
  ): Promise<{ bookingFlow?: BookingFlow; bookingId?: number | null }> {
    if (type === BookingDocumentType.BOOKING_CONFIRMATION) {
      if (workflow.bookingId) {
        throw new ConflictException(
          'A Booking cannot belong to another Booking',
        );
      }
      return { bookingFlow: workflow.bookingFlow ?? BookingFlow.EXPORT };
    }

    if (!workflow.bookingId) return { bookingId: null };

    const booking = (await this.findActiveOrFail(
      BookingDocumentType.BOOKING_CONFIRMATION,
      workflow.bookingId,
      false,
      manager,
    )) as BookingRecord;
    await this.assertMutable(
      BookingDocumentType.BOOKING_CONFIRMATION,
      booking,
      manager,
    );
    if (!WORKFLOW_TYPES[booking.bookingFlow].includes(type)) {
      throw new ConflictException(
        `${type.toUpperCase()} is not part of the ${booking.bookingFlow.toLowerCase()} workflow`,
      );
    }

    const repository = this.repository(type, manager);
    const existing = await repository.findOne({
      where: { bookingId: workflow.bookingId, deletedAt: IsNull() } as never,
    });
    if (existing) {
      throw new ConflictException(
        'This booking already has an active document of that type',
      );
    }

    if (type === BookingDocumentType.DELIVERY_ORDER) {
      const arrivalNotice = await this.repository(
        BookingDocumentType.ARRIVAL_NOTICE,
        manager,
      ).findOne({
        where: { bookingId: workflow.bookingId, deletedAt: IsNull() } as never,
      });
      if (!arrivalNotice) {
        throw new ConflictException(
          'Create the Arrival Notice before the final document',
        );
      }
    }
    return { bookingId: workflow.bookingId };
  }

  private clonePayload(
    payload: BookingDocumentPayload,
  ): Record<string, unknown> {
    return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  }

  private statusFor(
    type: BookingDocumentType,
    payload: Record<string, unknown>,
  ): BookingDocumentStatus {
    return missingRequiredDocumentFields(type, payload).length === 0
      ? BookingDocumentStatus.COMPLETED
      : BookingDocumentStatus.PROCESSING;
  }

  private missingRequiredFields(
    type: BookingDocumentType,
    payload: Record<string, unknown>,
  ): string[] {
    return missingRequiredDocumentFields(type, payload);
  }

  private workflowStatusFor(
    flow: BookingFlow,
    documents: Partial<
      Record<BookingDocumentType, { status: BookingDocumentStatus }>
    >,
  ): BookingDocumentStatus {
    return WORKFLOW_TYPES[flow].every(
      (documentType) =>
        documents[documentType]?.status === BookingDocumentStatus.COMPLETED,
    )
      ? BookingDocumentStatus.COMPLETED
      : BookingDocumentStatus.PROCESSING;
  }

  private async workflowStatusesForBookings(
    bookings: BookingRecord[],
  ): Promise<Map<number, BookingDocumentStatus>> {
    const ids = bookings.map((booking) => Number(booking.id));
    if (ids.length === 0) return new Map();
    const childTypes = [
      BookingDocumentType.BILL_OF_LADING,
      BookingDocumentType.ARRIVAL_NOTICE,
      BookingDocumentType.DELIVERY_ORDER,
    ] as const;
    const childGroups = await Promise.all(
      childTypes.map(async (type) => ({
        type,
        records: (await this.repository(type).find({
          where: { bookingId: In(ids), deletedAt: IsNull() } as never,
        })) as ChildRecord[],
      })),
    );
    const documentsByBooking = new Map<
      number,
      Partial<Record<BookingDocumentType, { status: BookingDocumentStatus }>>
    >();
    for (const booking of bookings) {
      documentsByBooking.set(Number(booking.id), {
        [BookingDocumentType.BOOKING_CONFIRMATION]: {
          status: booking.status,
        },
      });
    }
    for (const group of childGroups) {
      for (const record of group.records) {
        if (record.bookingId == null) continue;
        const documents = documentsByBooking.get(Number(record.bookingId));
        if (documents) documents[group.type] = { status: record.status };
      }
    }
    return new Map(
      bookings.map((booking) => {
        const id = Number(booking.id);
        return [
          id,
          this.workflowStatusFor(
            booking.bookingFlow,
            documentsByBooking.get(id) ?? {},
          ),
        ];
      }),
    );
  }

  private async casUpdate(
    type: BookingDocumentType,
    record: DocumentRecord,
    expectedVersion: number,
    changes: Record<string, unknown>,
    manager?: EntityManager,
    statePredicate?: string,
  ) {
    if (Number(record.version ?? 1) !== expectedVersion) {
      throw new ConflictException(
        'Document record was modified concurrently; reload and retry',
      );
    }
    let query = this.repository(type, manager)
      .createQueryBuilder()
      .update()
      .set({
        ...changes,
        version: () => '"version" + 1',
      })
      .where('id = :id', { id: Number(record.id) })
      .andWhere('version = :expectedVersion', { expectedVersion });
    query = query.andWhere('deleted_at IS NULL');
    if (statePredicate) query = query.andWhere(statePredicate);
    const result = await query.execute();
    if (result.affected !== 1) {
      throw new ConflictException(
        'Document record was modified concurrently; reload and retry',
      );
    }
    const updated = await this.repository(type, manager).findOne({
      where: { id: Number(record.id) },
    });
    if (!updated) throw new NotFoundException('Document record not found');
    if (manager && changes.payload && typeof changes.payload === 'object') {
      await this.syncRepeatedRows(
        type,
        Number(record.id),
        changes.payload as Record<string, unknown>,
        manager,
      );
    }
    return this.toResponse(type, updated);
  }

  /** Dual-write repeated rows during the expand phase. No placeholder row is persisted. */
  private async syncRepeatedRows(
    type: BookingDocumentType,
    documentId: number,
    payload: Record<string, unknown>,
    manager: EntityManager,
  ): Promise<void> {
    if (type === BookingDocumentType.BOOKING_CONFIRMATION) {
      await manager.query(
        'DELETE FROM booking_cargo_volumes WHERE booking_id = $1',
        [documentId],
      );
      for (const row of nonBlankCargoVolumes(payload)) {
        await manager.query(
          'INSERT INTO booking_cargo_volumes (booking_id, row_order, container_type_code, quantity) VALUES ($1,$2,$3,$4)',
          [documentId, row.rowOrder, row.containerTypeCode, row.quantity],
        );
      }
      return;
    }

    const table = {
      [BookingDocumentType.ARRIVAL_NOTICE]: 'arrival_notice_containers',
      [BookingDocumentType.DELIVERY_ORDER]: 'delivery_order_containers',
      [BookingDocumentType.BILL_OF_LADING]: 'bill_of_lading_containers',
    }[type];
    await manager.query(`DELETE FROM ${table} WHERE document_id = $1`, [
      documentId,
    ]);
    for (const [rowOrder, source] of nonBlankContainers(payload).entries()) {
      const row = source;
      const gross = parseReportNumber(row.grossWeight);
      const measurement = parseReportNumber(row.measurement);
      const tare = parseReportNumber(row.tare);
      const packages = parseReportNumber(row.noOfPkgs);
      const packageTypeId = await this.resolvePackageTypeId(row, manager);
      const packageCount =
        packages.numeric && /^\d+$/.test(packages.numeric)
          ? Number(packages.numeric)
          : null;
      await manager.query(
        `INSERT INTO ${table} (
          document_id,row_order,container_type_code,container_no,seal_no,
          gross_weight_kg,gross_weight_raw,measurement_cbm,measurement_raw,
          tare_kg,tare_raw,package_type_id,package_type_snapshot,
          number_of_packages,number_of_packages_raw,method,presentation_payload
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
        [
          documentId,
          rowOrder,
          this.optionalText(row.type),
          this.optionalText(row.containerNo),
          this.optionalText(row.sealNo),
          gross.numeric,
          gross.raw,
          measurement.numeric,
          measurement.raw,
          tare.numeric,
          tare.raw,
          packageTypeId,
          this.optionalText(row.packageType),
          packageCount,
          packages.raw,
          this.optionalText(row.method),
          JSON.stringify(
            this.optionalText(row.note)
              ? { note: this.optionalText(row.note) }
              : {},
          ),
        ],
      );
    }
  }

  private optionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private positiveId(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  private async resolvePackageTypeId(
    row: Record<string, unknown>,
    manager: EntityManager,
  ): Promise<number | null> {
    const explicit = this.positiveId(row.packageTypeId);
    if (explicit) return explicit;
    const snapshot = this.optionalText(row.packageType);
    if (!snapshot) return null;
    const matches: Array<{ id: number }> = await manager.query(
      `SELECT type.id FROM commodity_types type
        JOIN service_types service ON service.id = type.service_type_id
          AND UPPER(BTRIM(service.name)) = 'FREIGHT FORWARDING'
        WHERE TRUE
          AND LOWER(REGEXP_REPLACE(BTRIM(name), '\\s+', ' ', 'g')) =
              LOWER(REGEXP_REPLACE(BTRIM($1), '\\s+', ' ', 'g'))
        ORDER BY id LIMIT 2`,
      [snapshot],
    );
    return matches.length === 1 ? Number(matches[0].id) : null;
  }

  private referenceNumber(
    type: BookingDocumentType,
    payload: BookingDocumentPayload,
  ): string | null {
    let value: string | undefined;
    switch (type) {
      case BookingDocumentType.ARRIVAL_NOTICE:
        value = (payload as ArrivalNoticePreviewDto).anNumber;
        break;
      case BookingDocumentType.BOOKING_CONFIRMATION:
        value = (payload as BookingConfirmationPreviewDto).bookingNumber;
        break;
      case BookingDocumentType.DELIVERY_ORDER:
        value = (payload as DeliveryOrderPreviewDto).doNumber;
        break;
      case BookingDocumentType.BILL_OF_LADING:
        value = (payload as BillOfLadingPreviewDto).fblNumber;
        break;
    }
    return value?.trim() || null;
  }

  private toResponse(
    type: BookingDocumentType,
    record: BookingDocumentRecordBase,
    workflowStatus?: BookingDocumentStatus,
  ) {
    const bookingFlow =
      type === BookingDocumentType.BOOKING_CONFIRMATION
        ? (record as BookingRecord).bookingFlow
        : null;
    const bookingId =
      type === BookingDocumentType.BOOKING_CONFIRMATION
        ? null
        : ((record as ChildRecord).bookingId ?? null);

    return {
      id: Number(record.id),
      documentType: type,
      bookingFlow,
      bookingId: bookingId == null ? null : Number(bookingId),
      referenceNumber: this.referenceNumber(type, record.payload),
      payload: record.payload,
      status: record.status,
      ...(workflowStatus ? { workflowStatus } : {}),
      version: Number(record.version ?? 1),
      createdByUserId: record.createdByUserId,
      createdAt: record.createdAt.toISOString(),
      updatedAt:
        record.updatedAt?.toISOString() ?? record.createdAt.toISOString(),
      updatedByUserId: record.updatedByUserId ?? null,
      lockedAt: record.lockedAt ? record.lockedAt.toISOString() : null,
      deletedAt: record.deletedAt ? record.deletedAt.toISOString() : null,
      deletedByUserId: record.deletedByUserId ?? null,
      createdBy: record.createdBy
        ? {
            id: record.createdBy.id,
            fullName: record.createdBy.fullName ?? null,
            email: record.createdBy.email ?? null,
          }
        : null,
    };
  }
}
