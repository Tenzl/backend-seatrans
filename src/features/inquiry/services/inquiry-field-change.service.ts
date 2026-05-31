import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfirmedCustomerFieldChangeDto } from '../dto/confirmed-customer-field-change.dto';
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

  async logConfirmedChanges(
    inquiryId: number,
    actorUserId: number,
    action: InquiryFieldChangeAction,
    changes: ConfirmedCustomerFieldChangeDto[] | undefined,
    customerSubmittedSnapshot: Record<string, string> | null | undefined,
  ): Promise<void> {
    if (!changes?.length) return;

    const rows = changes.map((change) => {
      const original =
        originalValueFromSnapshot(customerSubmittedSnapshot, change.field) ??
        change.previousValue ??
        null;

      return this.logRepo.create({
        inquiryId,
        fieldName: change.field,
        previousValue: original,
        newValue: change.newValue ?? null,
        changedByUserId: actorUserId,
        action,
      });
    });

    await this.logRepo.save(rows);
  }

  async listForInquiry(
    inquiryId: number,
    page = 0,
    size = 6,
    customerSubmittedSnapshot?: Record<string, string> | null,
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

    const totalPages = totalElements === 0 ? 0 : Math.ceil(totalElements / safeSize);

    return {
      content: rows.map((row) => {
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
