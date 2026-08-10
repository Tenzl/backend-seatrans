import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager, FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { BaseInquiry } from '../entities/base-inquiry.entity';
import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';
import { CharteringBrokerageInquiryEntity } from '../entities/chartering-brokerage-inquiry.entity';
import { FreightForwardingInquiryEntity } from '../entities/freight-forwarding-inquiry.entity';
import { SpecialRequestInquiryEntity } from '../entities/special-request-inquiry.entity';
import { ServiceType } from '../../logistics/entities/service-type.entity';
import { InquiryStatus } from '../enums/inquiry-status.enum';
import {
  ListInquiriesQueryDto,
  type InquiryArchivedFilter,
} from '../dto/list-inquiries-query.dto';
import {
  InquiryResponseAudience,
  mapShippingAgencyInquiryFields,
} from '../mappers/shipping-agency-inquiry.mapper';
import {
  InquiryRepositoryRegistry,
  InquiryServiceSlug,
} from './inquiry-repository.registry';
import { buildContainsLikePattern } from '../../../shared/utils/like-pattern';

export type InquiryListCursor = {
  submittedAt: string;
  id: number;
};

export type InquiryPage = {
  content: unknown[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
  /** Present when more rows exist after this page (keyset-friendly). */
  nextCursor?: InquiryListCursor | null;
};

export type InquiryRowRef = {
  row: BaseInquiry;
  repo: Repository<BaseInquiry>;
  slug: string;
};

type InquiryListFilters = {
  user?: { id: number };
  status?: InquiryStatus;
  serviceType?: ServiceType;
  archivedFilter?: InquiryArchivedFilter;
};

type ParsedListFilters = {
  qPattern: string | null;
  dateFrom: Date | null;
  dateTo: Date | null;
};

@Injectable()
export class InquiryQueryService {
  private static readonly DEFAULT_PAGE_SIZE = 20;
  private static readonly MAX_PAGE_SIZE = 100;

  constructor(private readonly repositories: InquiryRepositoryRegistry) {}

  async list(
    filters: InquiryListFilters,
    query: ListInquiriesQueryDto,
    audience: InquiryResponseAudience = 'admin',
  ): Promise<InquiryPage> {
    const page = this.sanitizePage(query.page);
    const size = this.sanitizePageSize(query.size);
    const archivedFilter = filters.archivedFilter ?? 'active';

    if (filters.serviceType) {
      const slug = this.repositories.toSlug(filters.serviceType.name);
      return this.listSingleRepository(
        this.repositories.forSlug(slug),
        {
          user: filters.user,
          status: filters.status,
          archivedFilter,
        },
        query,
        page,
        size,
        audience,
        slug,
      );
    }

    return this.listAcrossRepositories(
      {
        user: filters.user,
        status: filters.status,
        archivedFilter,
      },
      query,
      page,
      size,
      audience,
    );
  }

  async require(serviceTypeName: string, id: number): Promise<BaseInquiry> {
    return (await this.requireWithRepository(serviceTypeName, id)).row;
  }

  async requireWithRepository(
    serviceTypeName: string,
    id: number,
    options: { includeDeleted?: boolean } = {},
    manager?: EntityManager,
  ): Promise<InquiryRowRef> {
    const slug = this.repositories.toSlug(serviceTypeName);
    const repo = this.repositories.forSlug(slug, manager);
    const where: FindOptionsWhere<BaseInquiry> = { id };
    if (!options.includeDeleted) {
      where.deletedAt = IsNull();
    }
    const row = await repo.findOne({
      where,
      relations: { serviceType: true, user: true },
    });
    if (!row) {
      throw new NotFoundException('Inquiry not found');
    }
    return { row, repo, slug };
  }

  async requireShippingAgency(
    id: number,
  ): Promise<ShippingAgencyInquiryEntity> {
    const row = await this.repositories.shippingAgency.findOne({
      where: { id, deletedAt: IsNull() },
      relations: { serviceType: true, user: true },
    });
    if (!row) {
      throw new NotFoundException('Inquiry not found');
    }
    return row;
  }

  async findRows(
    ids: number[],
    options: { includeDeleted?: boolean; serviceSlug?: string } = {},
    manager?: EntityManager,
  ): Promise<InquiryRowRef[]> {
    if (!ids.length) return [];

    const idsBySlug = await this.groupIdsBySlug(ids, options, manager);
    if (!idsBySlug.size) {
      return [];
    }

    const found: InquiryRowRef[] = [];
    for (const [slug, slugIds] of idsBySlug) {
      const repo = this.repositories.forSlug(slug, manager);
      const rows = await repo.find({
        where: slugIds.map((id) => {
          const clause: FindOptionsWhere<BaseInquiry> = { id };
          if (!options.includeDeleted) {
            clause.deletedAt = IsNull();
          }
          return clause;
        }),
        relations: { serviceType: true, user: true },
      });
      for (const row of rows) {
        found.push({ row, repo, slug });
      }
    }
    return found;
  }

  /**
   * Lightweight id→slug grouping for set-based batch mutations (no entity hydrate).
   * Returns an empty map when any requested id is missing under the filter.
   */
  async groupIdsBySlug(
    ids: number[],
    options: { includeDeleted?: boolean; serviceSlug?: string } = {},
    manager?: EntityManager,
  ): Promise<Map<string, number[]>> {
    const idsBySlug = new Map<string, number[]>();
    if (!ids.length) return idsBySlug;

    if (options.serviceSlug?.trim()) {
      const slug = this.repositories.toSlug(options.serviceSlug.trim());
      const tableName = this.repositories.tableNameForSlug(slug);
      const deletedFilter = options.includeDeleted
        ? ''
        : ' AND deleted_at IS NULL';
      const rows: Array<{ id: string | number }> = await (
        manager ?? this.repositories.shippingAgency.manager
      ).query(
        `SELECT id FROM ${tableName} WHERE id = ANY($1::bigint[])${deletedFilter}`,
        [ids.map(String)],
      );
      if (rows.length !== ids.length) {
        return new Map();
      }
      idsBySlug.set(
        slug,
        rows.map((row) => Number(row.id)),
      );
      return idsBySlug;
    }

    const refs = await this.resolveReferences(ids, options, manager);
    if (refs.length !== ids.length) {
      return new Map();
    }
    for (const ref of refs) {
      const list = idsBySlug.get(ref.slug) ?? [];
      list.push(ref.id);
      idsBySlug.set(ref.slug, list);
    }
    return idsBySlug;
  }

  /**
   * Confirm every id exists, is active, and is owned by userId (set-based).
   * Returns false when any id is missing or owned by someone else.
   */
  async allOwnedByUser(
    ids: number[],
    userId: number,
    serviceSlug: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    if (!ids.length) return true;
    const slug = this.repositories.toSlug(serviceSlug);
    const tableName = this.repositories.tableNameForSlug(slug);
    const rows: Array<{ id: string | number }> = await (
      manager ?? this.repositories.shippingAgency.manager
    ).query(
      `SELECT id FROM ${tableName}
       WHERE id = ANY($1::bigint[])
         AND deleted_at IS NULL
         AND user_id = $2`,
      [ids, userId],
    );
    return rows.length === ids.length;
  }

  toResponse(
    row: BaseInquiry,
    audience: InquiryResponseAudience = 'admin',
  ): Record<string, unknown> {
    const serviceSlug = this.repositories.toSlug(row.serviceType.name);
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
      deletedAt: row.deletedAt,
      isArchived: row.deletedAt != null,
    };

    if (serviceSlug === 'shipping-agency') {
      return {
        ...base,
        ...mapShippingAgencyInquiryFields(
          row as ShippingAgencyInquiryEntity,
          audience,
        ),
      };
    }
    if (serviceSlug === 'chartering') {
      const inquiry = row as CharteringBrokerageInquiryEntity;
      return {
        ...base,
        cargoQuantity: inquiry.cargoQuantity,
        loadingPort: inquiry.loadingPort,
        dischargingPort: inquiry.dischargingPort,
        laycanFrom: inquiry.laycanFrom,
        laycanTo: inquiry.laycanTo,
        otherInfo: inquiry.otherInfo,
      };
    }
    if (
      serviceSlug === 'freight-forwarding' ||
      serviceSlug === 'total-logistic'
    ) {
      const inquiry = row as FreightForwardingInquiryEntity;
      return {
        ...base,
        cargoName: inquiry.cargoName,
        deliveryTerm: inquiry.deliveryTerm,
        container20: inquiry.container20ft,
        container40: inquiry.container40ft,
        loadingPort: inquiry.loadingPort,
        dischargingPort: inquiry.dischargingPort,
        shipmentFrom: inquiry.shipmentFrom,
        shipmentTo: inquiry.shipmentTo,
      };
    }
    if (serviceSlug === 'special-request') {
      const inquiry = row as SpecialRequestInquiryEntity;
      return {
        ...base,
        subject: inquiry.subject,
        preferredProvinceId: inquiry.preferredProvinceId,
        relatedDepartmentId: inquiry.relatedDepartmentId,
        message: inquiry.message,
        otherInfo: inquiry.otherInfo,
      };
    }
    return base;
  }

  private parseCursor(query: ListInquiriesQueryDto): InquiryListCursor | null {
    if (!query.cursorSubmittedAt || query.cursorId == null) {
      return null;
    }
    const id = Number(query.cursorId);
    if (!Number.isInteger(id) || id < 1) return null;
    const submittedAt = new Date(query.cursorSubmittedAt);
    if (Number.isNaN(submittedAt.getTime())) return null;
    return { submittedAt: submittedAt.toISOString(), id };
  }

  private parseListFilters(query: ListInquiriesQueryDto): ParsedListFilters {
    const q = query.q?.trim();
    const dateFromRaw = query.dateFrom?.trim();
    const dateToRaw = query.dateTo?.trim();
    const dateFrom = dateFromRaw ? new Date(dateFromRaw) : null;
    const dateTo = dateToRaw ? new Date(dateToRaw) : null;
    return {
      qPattern: q ? buildContainsLikePattern(q) : null,
      dateFrom: dateFrom && !Number.isNaN(dateFrom.getTime()) ? dateFrom : null,
      dateTo: dateTo && !Number.isNaN(dateTo.getTime()) ? dateTo : null,
    };
  }

  private nextCursorFromRows(
    rows: Array<{ submittedAt?: Date | null; id: number }>,
    size: number,
  ): InquiryListCursor | null {
    if (rows.length < size) return null;
    const last = rows[rows.length - 1];
    if (!last?.submittedAt) return null;
    return {
      submittedAt: new Date(last.submittedAt).toISOString(),
      id: Number(last.id),
    };
  }

  /**
   * List one service table. Prefer keyset when cursor is present; otherwise
   * keep page/OFFSET for existing clients. Hydrate with serviceType only
   * (toResponse does not use the user relation).
   */
  private async listSingleRepository(
    repo: Repository<BaseInquiry>,
    filters: {
      user?: { id: number };
      status?: InquiryStatus;
      archivedFilter: InquiryArchivedFilter;
    },
    query: ListInquiriesQueryDto,
    page: number,
    size: number,
    audience: InquiryResponseAudience,
    serviceSlug: string,
  ): Promise<InquiryPage> {
    const listFilters = this.parseListFilters(query);
    const cursor = this.parseCursor(query);
    const qb = repo
      .createQueryBuilder('inquiry')
      .leftJoinAndSelect('inquiry.serviceType', 'serviceType')
      .orderBy('inquiry.submittedAt', 'DESC')
      .addOrderBy('inquiry.id', 'DESC');

    if (
      audience === 'admin' &&
      this.repositories.isShippingAgency(serviceSlug)
    ) {
      qb.leftJoinAndSelect('inquiry.user', 'clientSubmittedBy');
      qb.leftJoinAndSelect('inquiry.processedBy', 'employeeInCharge');
    }

    if (filters.archivedFilter === 'active') {
      qb.andWhere('inquiry.deleted_at IS NULL');
    } else if (filters.archivedFilter === 'archived') {
      qb.andWhere('inquiry.deleted_at IS NOT NULL');
    }
    if (filters.user) {
      qb.andWhere('inquiry.user_id = :userId', { userId: filters.user.id });
    }
    if (filters.status) {
      qb.andWhere('inquiry.status = :status', { status: filters.status });
    }
    this.applySearchAndDateFilters(qb, listFilters, {
      alias: 'inquiry',
      includeMv: this.repositories.isShippingAgency(serviceSlug),
    });

    // Count the full filtered set before applying keyset cursor (stable totals).
    const totalElements = await qb.getCount();
    if (totalElements === 0) {
      return {
        content: [],
        totalElements: 0,
        totalPages: 0,
        size,
        number: page,
        nextCursor: null,
      };
    }

    if (cursor) {
      qb.andWhere(
        '(inquiry.submitted_at, inquiry.id) < (:cursorSubmittedAt, :cursorId)',
        {
          cursorSubmittedAt: new Date(cursor.submittedAt),
          cursorId: cursor.id,
        },
      );
    } else {
      qb.skip(page * size);
    }
    qb.take(size);
    const rows = await qb.getMany();
    return {
      content: rows.map((row) => this.toResponse(row, audience)),
      totalElements,
      totalPages: Math.ceil(totalElements / size),
      size,
      number: page,
      nextCursor: this.nextCursorFromRows(rows, size),
    };
  }

  private applySearchAndDateFilters(
    qb: {
      andWhere: (sql: string, params?: Record<string, unknown>) => unknown;
    },
    filters: ParsedListFilters,
    options: { alias: string; includeMv: boolean },
  ): void {
    const { alias, includeMv } = options;
    if (filters.dateFrom) {
      qb.andWhere(`${alias}.submitted_at >= :dateFrom`, {
        dateFrom: filters.dateFrom,
      });
    }
    if (filters.dateTo) {
      qb.andWhere(`${alias}.submitted_at <= :dateTo`, {
        dateTo: filters.dateTo,
      });
    }
    if (filters.qPattern) {
      const mvClause = includeMv
        ? ` OR LOWER(COALESCE(${alias}.mv, '')) LIKE :q ESCAPE E'\\\\'`
        : '';
      qb.andWhere(
        `(LOWER(COALESCE(${alias}.code, '')) LIKE :q ESCAPE E'\\\\'
          OR LOWER(COALESCE(${alias}.full_name, '')) LIKE :q ESCAPE E'\\\\'
          OR LOWER(COALESCE(${alias}.company, '')) LIKE :q ESCAPE E'\\\\'
          OR LOWER(COALESCE(${alias}.email, '')) LIKE :q ESCAPE E'\\\\'
          OR LOWER(COALESCE(${alias}.status, '')) LIKE :q ESCAPE E'\\\\'${mvClause})`,
        { q: filters.qPattern },
      );
    }
  }

  private async listAcrossRepositories(
    filters: {
      user?: { id: number };
      status?: InquiryStatus;
      archivedFilter?: InquiryArchivedFilter;
    },
    query: ListInquiriesQueryDto,
    page: number,
    size: number,
    audience: InquiryResponseAudience,
  ): Promise<InquiryPage> {
    const archivedFilter = filters.archivedFilter ?? 'active';
    const deletedFilter =
      archivedFilter === 'all'
        ? ''
        : archivedFilter === 'archived'
          ? ' WHERE deleted_at IS NOT NULL'
          : ' WHERE deleted_at IS NULL';
    const listFilters = this.parseListFilters(query);

    // Table identifiers come only from the static registry; all variable
    // filters remain query parameters. Projection stays narrow (id + sort keys
    // + filter columns + slug) — full rows are hydrated only for the page ids.
    // `mv` exists only on shipping_agency; other services project NULL.
    const union = this.repositories.sources
      .map(({ tableName, slug }) => {
        const mvExpr =
          slug === 'shipping-agency' ? 'mv' : 'NULL::varchar AS mv';
        return `SELECT id, submitted_at, user_id, status, code, full_name, company, email, ${mvExpr}, '${slug}'::text AS slug FROM ${tableName}${deletedFilter}`;
      })
      .join(' UNION ALL ');
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (filters.user) {
      params.push(filters.user.id);
      conditions.push(`user_id = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    if (listFilters.dateFrom) {
      params.push(listFilters.dateFrom);
      conditions.push(`submitted_at >= $${params.length}::timestamptz`);
    }
    if (listFilters.dateTo) {
      params.push(listFilters.dateTo);
      conditions.push(`submitted_at <= $${params.length}::timestamptz`);
    }
    if (listFilters.qPattern) {
      params.push(listFilters.qPattern);
      const idx = params.length;
      conditions.push(
        `(LOWER(COALESCE(code, '')) LIKE $${idx} ESCAPE E'\\\\'
          OR LOWER(COALESCE(full_name, '')) LIKE $${idx} ESCAPE E'\\\\'
          OR LOWER(COALESCE(company, '')) LIKE $${idx} ESCAPE E'\\\\'
          OR LOWER(COALESCE(email, '')) LIKE $${idx} ESCAPE E'\\\\'
          OR LOWER(COALESCE(status, '')) LIKE $${idx} ESCAPE E'\\\\'
          OR LOWER(COALESCE(mv, '')) LIKE $${idx} ESCAPE E'\\\\')`,
      );
    }
    const filterWhereSql = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';
    const manager = this.repositories.shippingAgency.manager;
    // Full-set count (ignore cursor) so totalPages stays stable across pages.
    const countRows: Array<{ total: number }> = await manager.query(
      `SELECT COUNT(*)::int AS total FROM (${union}) AS t ${filterWhereSql}`,
      params,
    );
    const totalElements = countRows[0]?.total ?? 0;
    if (totalElements === 0) {
      return {
        content: [],
        totalElements: 0,
        totalPages: 0,
        size,
        number: page,
        nextCursor: null,
      };
    }

    const pageParams = [...params];
    const pageConditions = [...conditions];
    const cursor = this.parseCursor(query);
    if (cursor) {
      pageParams.push(new Date(cursor.submittedAt));
      const submittedIdx = pageParams.length;
      pageParams.push(cursor.id);
      const idIdx = pageParams.length;
      pageConditions.push(
        `(submitted_at, id) < ($${submittedIdx}::timestamptz, $${idIdx}::bigint)`,
      );
    }
    const pageWhereSql = pageConditions.length
      ? `WHERE ${pageConditions.join(' AND ')}`
      : '';
    pageParams.push(size);
    const limitIndex = pageParams.length;
    let pageSql =
      `SELECT id, slug, submitted_at FROM (${union}) AS t ${pageWhereSql} ` +
      `ORDER BY submitted_at DESC, id DESC LIMIT $${limitIndex}`;
    if (!cursor) {
      pageParams.push(page * size);
      const offsetIndex = pageParams.length;
      pageSql += ` OFFSET $${offsetIndex}`;
    }
    const pageRows: Array<{
      id: string | number;
      slug: InquiryServiceSlug;
      submitted_at: Date | string;
    }> = await manager.query(pageSql, pageParams);
    const idsBySlug = new Map<InquiryServiceSlug, number[]>();
    for (const { id, slug } of pageRows) {
      const ids = idsBySlug.get(slug) ?? [];
      ids.push(Number(id));
      idsBySlug.set(slug, ids);
    }

    const rowByKey = new Map<string, BaseInquiry>();
    for (const [slug, ids] of idsBySlug) {
      // Admin shipping rows also need the two party relations shown in EPDA.
      const rows = await this.repositories.forSlug(slug).find({
        where: ids.map((id) => ({ id })),
        relations:
          audience === 'admin' && this.repositories.isShippingAgency(slug)
            ? { serviceType: true, user: true, processedBy: true }
            : { serviceType: true },
      });
      for (const row of rows) {
        rowByKey.set(`${slug}:${row.id}`, row);
      }
    }
    const ordered = pageRows
      .map(({ id, slug }) => rowByKey.get(`${slug}:${Number(id)}`))
      .filter((row): row is BaseInquiry => row != null);
    const content = ordered.map((row) => this.toResponse(row, audience));
    return {
      content,
      totalElements,
      totalPages: Math.ceil(totalElements / size),
      size,
      number: page,
      nextCursor: this.nextCursorFromRows(ordered, size),
    };
  }

  private async resolveReferences(
    ids: number[],
    options: { includeDeleted?: boolean },
    manager?: EntityManager,
  ): Promise<Array<{ id: number; slug: string }>> {
    const deletedFilter = options.includeDeleted
      ? ''
      : ' AND deleted_at IS NULL';
    const union = this.repositories.sources
      .map(
        ({ tableName, slug }) =>
          `SELECT id, '${slug}'::text AS slug FROM ${tableName} WHERE id = ANY($1)${deletedFilter}`,
      )
      .join(' UNION ALL ');
    const rows: Array<{ id: string | number; slug: string }> = await (
      manager ?? this.repositories.shippingAgency.manager
    ).query(`SELECT id, slug FROM (${union}) AS t`, [ids]);
    return rows.map((row) => ({ id: Number(row.id), slug: row.slug }));
  }

  private sanitizePage(page?: number): number {
    return !Number.isFinite(page) || page == null || page < 0 ? 0 : page;
  }

  private sanitizePageSize(size?: number): number {
    if (!Number.isFinite(size) || size == null || size <= 0) {
      return InquiryQueryService.DEFAULT_PAGE_SIZE;
    }
    return Math.min(size, InquiryQueryService.MAX_PAGE_SIZE);
  }
}
