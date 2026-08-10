import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import {
  InquiryFieldChangeAction,
  InquiryFieldChangeLog,
} from '../entities/inquiry-field-change-log.entity';
import { originalValueFromSnapshot } from '../utils/customer-submitted-snapshot.util';

export type InquiryFieldChangeLogRow = {
  id: number;
  inquiryId: number;
  fieldName: string;
  previousValue: string | null;
  newValue: string | null;
  action: InquiryFieldChangeAction;
  createdAt: string;
  changedBy: {
    id: number;
    fullName: string | null;
    email: string | null;
  };
};

export type InquiryFieldChangePage = {
  content: InquiryFieldChangeLogRow[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
};

@Injectable()
export class InquiryFieldChangeService {
  constructor(
    @InjectRepository(InquiryFieldChangeLog)
    private readonly logRepo: Repository<InquiryFieldChangeLog>,
  ) {}

  /**
   * Log every changed field (full audit). `changes` are already diffed pairs;
   * entries with equal previous/new values are skipped.
   */
  async logFieldChanges(
    inquiryId: number,
    actorUserId: number,
    action: InquiryFieldChangeAction,
    changes: Array<{
      field: string;
      previousValue: string | null;
      newValue: string | null;
    }>,
    manager?: EntityManager,
  ): Promise<void> {
    const repository =
      manager?.getRepository(InquiryFieldChangeLog) ?? this.logRepo;
    const rows = changes
      .filter((c) => (c.previousValue ?? null) !== (c.newValue ?? null))
      .map((c) =>
        repository.create({
          inquiryId,
          fieldName: c.field,
          previousValue: c.previousValue ?? null,
          newValue: c.newValue ?? null,
          changedByUserId: actorUserId,
          action,
        }),
      );
    if (!rows.length) return;
    await repository.save(rows);
  }

  async listForInquiry(
    inquiryId: number,
    page = 0,
    size = 6,
  ): Promise<InquiryFieldChangePage> {
    const safePage = Math.max(0, page);
    const safeSize = Math.min(50, Math.max(1, size));

    const [rows, totalElements] = await this.logRepo.findAndCount({
      where: { inquiryId },
      relations: { changedBy: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: safePage * safeSize,
      take: safeSize,
    });

    const totalPages =
      totalElements === 0 ? 0 : Math.ceil(totalElements / safeSize);

    return {
      content: rows.map((row) => {
        return {
          id: row.id,
          inquiryId: row.inquiryId,
          fieldName: row.fieldName,
          previousValue: row.previousValue,
          newValue: row.newValue,
          action: row.action,
          createdAt: row.createdAt.toISOString(),
          changedBy: {
            id: row.changedByUserId,
            fullName: row.changedBy?.fullName ?? null,
            email: row.changedBy?.email ?? null,
          },
        };
      }),
      totalElements,
      totalPages,
      size: safeSize,
      number: safePage,
    };
  }

  async listLatestForFields(
    inquiryId: number,
    fieldNames: string[],
    customerSubmittedSnapshot?: Record<string, string> | null,
  ): Promise<InquiryFieldChangeLogRow[]> {
    if (!fieldNames.length) return [];

    const allChanges = await this.logRepo.find({
      where: { inquiryId, fieldName: In(fieldNames) },
      relations: { changedBy: true },
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    const latestByField = new Map<string, InquiryFieldChangeLog>();
    for (const change of allChanges) {
      if (!latestByField.has(change.fieldName)) {
        latestByField.set(change.fieldName, change);
      }
    }

    return Array.from(latestByField.values()).map((row) => {
      const original =
        originalValueFromSnapshot(customerSubmittedSnapshot, row.fieldName) ??
        row.previousValue;

      return {
        id: row.id,
        inquiryId: row.inquiryId,
        fieldName: row.fieldName,
        previousValue: original,
        newValue: row.newValue,
        action: row.action,
        createdAt: row.createdAt.toISOString(),
        changedBy: {
          id: row.changedByUserId,
          fullName: row.changedBy?.fullName ?? null,
          email: row.changedBy?.email ?? null,
        },
      };
    });
  }
}
