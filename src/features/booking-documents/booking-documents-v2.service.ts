import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BookingDocumentsService } from './booking-documents.service';
import { BookingDocumentStatus } from './enums/booking-document-status.enum';
import { BookingDocumentType } from './enums/booking-document-type.enum';
import { BookingFlow } from './enums/booking-flow.enum';
import {
  nonBlankCargoVolumes,
  nonBlankContainers,
  isPresentationField,
  projectRelationalFields,
} from './booking-document-relational-projector';

type V2Envelope = {
  document?: Record<string, unknown>;
  presentation?: Record<string, unknown>;
  cargoVolumes?: Array<{ containerTypeCode?: string; quantity?: number }>;
  containers?: Array<Record<string, unknown>>;
  expectedVersion?: number;
  bookingFlow?: string;
  bookingId?: number;
};

type LegacyWireRecord = Awaited<
  ReturnType<BookingDocumentsService['getRecord']>
>;

type BookingReportRow = Record<string, unknown>;

type BookingReportSummaryRow = {
  total_bookings?: number | string | null;
  planned_containers?: number | string | null;
  planned_gross_weight_kg?: number | string | null;
  planned_measurement_cbm?: number | string | null;
  actual_containers?: number | string | null;
  actual_gross_weight_kg?: number | string | null;
  actual_measurement_cbm?: number | string | null;
};

@Injectable()
export class BookingDocumentsV2Service {
  constructor(
    private readonly legacy: BookingDocumentsService,
    private readonly dataSource: DataSource,
  ) {}

  async create(type: BookingDocumentType, body: unknown, actor: number) {
    return this.toWire(
      await this.legacy.createRecord(type, this.toLegacy(body), actor),
    );
  }

  async update(
    type: BookingDocumentType,
    id: number,
    body: unknown,
    actor: number,
  ) {
    return this.toWire(
      await this.legacy.updateRecord(type, id, this.toLegacy(body), actor),
    );
  }

  async get(type: BookingDocumentType, id: number) {
    return this.toWire(await this.legacy.getRecord(type, id));
  }

  async list(
    type: BookingDocumentType,
    page: number,
    size: number,
    bookingNo: string,
  ) {
    const result = await this.legacy.listRecords(type, page, size, bookingNo);
    return {
      ...result,
      content: result.content.map((record) => this.toWire(record)),
    };
  }

  async report(query: Record<string, string | undefined>) {
    const page = Math.max(0, Number.parseInt(query.page ?? '0', 10) || 0);
    const size = Math.min(
      100,
      Math.max(1, Number.parseInt(query.size ?? '20', 10) || 20),
    );
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      where.push(sql.replace('?', `$${values.length}`));
    };
    if (query.flow) {
      const flow = query.flow.toUpperCase();
      if (!Object.values(BookingFlow).includes(flow as BookingFlow))
        throw new BadRequestException('flow must be EXPORT or IMPORT');
      add('booking_flow = ?', flow);
    }
    if (query.status) {
      const status = query.status.toUpperCase();
      if (
        !Object.values(BookingDocumentStatus).includes(
          status as BookingDocumentStatus,
        )
      )
        throw new BadRequestException('status must be PROCESSING or COMPLETED');
      add('workflow_status = ?', status);
    }
    if (query.bookingNo?.trim())
      add('booking_number ILIKE ?', `%${query.bookingNo.trim()}%`);
    if (query.dateFrom)
      add(
        'booking_date >= ?::date',
        this.reportDate(query.dateFrom, 'dateFrom'),
      );
    if (query.dateTo)
      add('booking_date <= ?::date', this.reportDate(query.dateTo, 'dateTo'));
    if (query.clientPartyId)
      add(
        'client_party_id = ?::int',
        this.reportId(query.clientPartyId, 'clientPartyId'),
      );
    if (query.client?.trim())
      add('client_name ILIKE ?', `%${query.client.trim()}%`);
    if (query.portOfLoadingId)
      add(
        'port_of_loading_id = ?::int',
        this.reportId(query.portOfLoadingId, 'portOfLoadingId'),
      );
    if (query.portOfDischargeId)
      add(
        'port_of_discharge_id = ?::int',
        this.reportId(query.portOfDischargeId, 'portOfDischargeId'),
      );
    if (query.commodityTypeId)
      add(
        'commodity_type_id = ?::int',
        this.reportId(query.commodityTypeId, 'commodityTypeId'),
      );
    if (query.commodityId)
      add(
        'commodity_id = ?::int',
        this.reportId(query.commodityId, 'commodityId'),
      );
    if (query.vesselVoyage?.trim())
      add('vessel_voyage ILIKE ?', `%${query.vesselVoyage.trim()}%`);
    for (const [parameter, column] of [
      ['hasBl', 'has_bl'],
      ['hasAn', 'has_an'],
      ['hasDo', 'has_do'],
    ] as const) {
      if (query[parameter] === 'true' || query[parameter] === 'false')
        add(`${column} = ?::boolean`, query[parameter]);
    }
    const reportSource = `(SELECT source.*,
      CASE
        WHEN source.booking_status = 'COMPLETED'
          AND source.booking_flow = 'EXPORT'
          AND source.has_bl
          AND source.bl_status = 'COMPLETED'
          THEN 'COMPLETED'
        WHEN source.booking_status = 'COMPLETED'
          AND source.booking_flow = 'IMPORT'
          AND source.has_an
          AND source.an_status = 'COMPLETED'
          AND source.has_do
          AND source.do_status = 'COMPLETED'
          THEN 'COMPLETED'
        ELSE 'PROCESSING'
      END AS workflow_status
      FROM booking_reporting_v1 source) booking_report`;
    const predicate = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortColumns: Record<string, string> = {
      bookingDate: 'booking_date',
      bookingNumber: 'booking_number',
      client: 'client_name',
      vesselVoyage: 'vessel_voyage',
      plannedContainers: 'planned_container_count',
      actualContainers: 'actual_container_count',
      updatedAt: 'updated_at',
    };
    const sortColumn =
      sortColumns[query.sortBy ?? 'bookingDate'] ?? 'booking_date';
    const sortDirection =
      query.sortDirection?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const [rows, summaryRows] = await Promise.all([
      this.dataSource.query<BookingReportRow[]>(
        `SELECT * FROM ${reportSource} ${predicate}
          ORDER BY ${sortColumn} ${sortDirection} NULLS LAST, booking_id DESC
          LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, size, page * size],
      ),
      this.dataSource.query<BookingReportSummaryRow[]>(
        `SELECT COUNT(*)::int AS total_bookings,
                COALESCE(SUM(planned_container_count),0)::bigint AS planned_containers,
                COALESCE(SUM(planned_gross_weight_kg),0)::numeric(18,3) AS planned_gross_weight_kg,
                COALESCE(SUM(planned_measurement_cbm),0)::numeric(18,3) AS planned_measurement_cbm,
                COALESCE(SUM(actual_container_count),0)::bigint AS actual_containers,
                COALESCE(SUM(actual_gross_weight_kg),0)::numeric(18,3) AS actual_gross_weight_kg,
                COALESCE(SUM(actual_measurement_cbm),0)::numeric(18,3) AS actual_measurement_cbm
           FROM ${reportSource} ${predicate}`,
        values,
      ),
    ]);
    const summary = summaryRows[0] ?? {};
    const totalElements = Number(summary.total_bookings ?? 0);
    return {
      content: rows,
      summary,
      totalElements,
      totalPages: totalElements ? Math.ceil(totalElements / size) : 0,
      size,
      number: page,
    };
  }

  private toLegacy(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Request body must be an object');
    const envelope = body as V2Envelope;
    if (
      !envelope.document ||
      typeof envelope.document !== 'object' ||
      Array.isArray(envelope.document)
    )
      throw new BadRequestException('document must be an object');
    if (
      envelope.presentation &&
      (typeof envelope.presentation !== 'object' ||
        Array.isArray(envelope.presentation))
    )
      throw new BadRequestException('presentation must be an object');
    if (
      envelope.cargoVolumes !== undefined &&
      !Array.isArray(envelope.cargoVolumes)
    )
      throw new BadRequestException('cargoVolumes must be an array');
    if (
      envelope.containers !== undefined &&
      !Array.isArray(envelope.containers)
    )
      throw new BadRequestException('containers must be an array');
    if ((envelope.cargoVolumes?.length ?? 0) > 20)
      throw new BadRequestException(
        'cargoVolumes must contain at most 20 rows',
      );
    if ((envelope.containers?.length ?? 0) > 20)
      throw new BadRequestException('containers must contain at most 20 rows');
    if (
      envelope.cargoVolumes?.some(
        (row) => !row || typeof row !== 'object' || Array.isArray(row),
      )
    )
      throw new BadRequestException('cargoVolumes rows must be objects');
    if (
      envelope.containers?.some(
        (row) => !row || typeof row !== 'object' || Array.isArray(row),
      )
    )
      throw new BadRequestException('containers rows must be objects');
    const invalidPresentationKeys = Object.keys(
      envelope.presentation ?? {},
    ).filter((key) => !isPresentationField(key));
    if (invalidPresentationKeys.length) {
      throw new BadRequestException(
        `presentation contains operational fields: ${invalidPresentationKeys.join(', ')}`,
      );
    }
    const cargoVolumes = Object.fromEntries(
      (envelope.cargoVolumes ?? [])
        .filter(
          (row) =>
            row.containerTypeCode?.trim() &&
            Number.isInteger(row.quantity) &&
            Number(row.quantity) > 0,
        )
        .map((row) => [row.containerTypeCode!.trim(), row.quantity]),
    );
    const metadata = Object.fromEntries(
      Object.entries({
        expectedVersion: envelope.expectedVersion,
        bookingFlow: envelope.bookingFlow,
        bookingId: envelope.bookingId,
      }).filter(([, value]) => value !== undefined),
    );
    return {
      ...envelope.document,
      ...(envelope.presentation ?? {}),
      ...(envelope.cargoVolumes ? { cargoVolumes } : {}),
      ...(envelope.containers ? { containers: envelope.containers } : {}),
      ...metadata,
    };
  }

  private toWire(record: LegacyWireRecord) {
    const payload = record.payload ?? {};
    const projection = projectRelationalFields(record.documentType, payload);
    const presentation = projection.presentationPayload as Record<
      string,
      unknown
    >;
    const presentationKeys = new Set(Object.keys(presentation));
    const document = Object.fromEntries(
      Object.entries(payload).filter(
        ([key]) =>
          !presentationKeys.has(key) &&
          key !== 'cargoVolumes' &&
          key !== 'containers',
      ),
    );
    return {
      id: record.id,
      documentType: record.documentType,
      bookingFlow: record.bookingFlow,
      bookingId: record.bookingId,
      document,
      presentation,
      cargoVolumes: nonBlankCargoVolumes(payload),
      containers: nonBlankContainers(payload),
      status: record.status,
      workflowStatus: record.workflowStatus,
      version: record.version,
      createdByUserId: record.createdByUserId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lockedAt: record.lockedAt,
      createdBy: record.createdBy ?? null,
    };
  }

  private reportId(value: string, field: string): number {
    if (!/^[1-9]\d*$/.test(value))
      throw new BadRequestException(`${field} must be a positive integer`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed))
      throw new BadRequestException(`${field} must be a safe integer`);
    return parsed;
  }

  private reportDate(value: string, field: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new BadRequestException(`${field} must use YYYY-MM-DD`);
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    )
      throw new BadRequestException(`${field} is not a valid date`);
    return value;
  }
}
