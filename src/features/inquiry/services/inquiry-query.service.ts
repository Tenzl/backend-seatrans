import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EntityManager,
  FindOptionsWhere,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { BaseInquiry } from '../entities/base-inquiry.entity';
import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';
import { CharteringBrokerageInquiryEntity } from '../entities/chartering-brokerage-inquiry.entity';
import { FreightForwardingInquiryEntity } from '../entities/freight-forwarding-inquiry.entity';
import { SpecialRequestInquiryEntity } from '../entities/special-request-inquiry.entity';
import { ServiceType } from '../../logistics/entities/service-type.entity';
import { User } from '../../auth/entities/user.entity';
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

export type InquiryPage = {
  content: unknown[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
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
    const where: FindOptionsWhere<BaseInquiry> = {};
    const archivedFilter = filters.archivedFilter ?? 'active';

    if (archivedFilter === 'active') {
      where.deletedAt = IsNull();
    } else if (archivedFilter === 'archived') {
      where.deletedAt = Not(IsNull());
    }
    if (filters.user) {
      where.user = { id: filters.user.id } as User;
    }
    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.serviceType) {
      const repo = this.repositories.forSlug(filters.serviceType.name);
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

    return this.listAcrossRepositories(
      {
        user: filters.user,
        status: filters.status,
        archivedFilter,
      },
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

    const idsBySlug = new Map<string, number[]>();
    if (options.serviceSlug?.trim()) {
      const slug = this.repositories.toSlug(options.serviceSlug.trim());
      idsBySlug.set(slug, [...ids]);
    } else {
      const refs = await this.resolveReferences(ids, options, manager);
      if (refs.length !== ids.length) {
        return [];
      }
      for (const ref of refs) {
        const list = idsBySlug.get(ref.slug) ?? [];
        list.push(ref.id);
        idsBySlug.set(ref.slug, list);
      }
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

  private async listAcrossRepositories(
    filters: {
      user?: { id: number };
      status?: InquiryStatus;
      archivedFilter?: InquiryArchivedFilter;
    },
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

    // Table identifiers come only from the static registry; all variable
    // filters remain query parameters.
    const union = this.repositories.sources
      .map(
        ({ tableName, slug }) =>
          `SELECT id, submitted_at, user_id, status, '${slug}'::text AS slug FROM ${tableName}${deletedFilter}`,
      )
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
    const whereSql = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';
    const manager = this.repositories.shippingAgency.manager;
    const countRows: Array<{ total: number }> = await manager.query(
      `SELECT COUNT(*)::int AS total FROM (${union}) AS t ${whereSql}`,
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
      };
    }

    params.push(size);
    const limitIndex = params.length;
    params.push(page * size);
    const offsetIndex = params.length;
    const pageRows: Array<{ id: string | number; slug: InquiryServiceSlug }> =
      await manager.query(
        `SELECT id, slug FROM (${union}) AS t ${whereSql} ` +
          `ORDER BY submitted_at DESC, id DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
        params,
      );
    const idsBySlug = new Map<InquiryServiceSlug, number[]>();
    for (const { id, slug } of pageRows) {
      const ids = idsBySlug.get(slug) ?? [];
      ids.push(Number(id));
      idsBySlug.set(slug, ids);
    }

    const rowByKey = new Map<string, BaseInquiry>();
    for (const [slug, ids] of idsBySlug) {
      const rows = await this.repositories.forSlug(slug).find({
        where: ids.map((id) => ({ id })),
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
