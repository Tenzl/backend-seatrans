import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  BookingPartnerFieldChangeAction,
  BookingPartnerFieldChangeLog,
} from '../entities/booking-partner-field-change-log.entity';

export type BookingPartnerFieldChangeLogRow = {
  id: number;
  partnerId: number;
  fieldName: string;
  previousValue: string | null;
  newValue: string | null;
  action: BookingPartnerFieldChangeAction;
  createdAt: string;
  changedBy: {
    id: number;
    fullName: string | null;
    email: string | null;
  };
};

export type BookingPartnerFieldChangePage = {
  content: BookingPartnerFieldChangeLogRow[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
};

@Injectable()
export class BookingPartnerFieldChangeService {
  constructor(
    @InjectRepository(BookingPartnerFieldChangeLog)
    private readonly logRepo: Repository<BookingPartnerFieldChangeLog>,
  ) {}

  async logFieldChanges(
    partnerId: number,
    actorUserId: number,
    action: BookingPartnerFieldChangeAction,
    changes: Array<{
      field: string;
      previousValue: string | null;
      newValue: string | null;
    }>,
    manager?: EntityManager,
  ): Promise<void> {
    const repository =
      manager?.getRepository(BookingPartnerFieldChangeLog) ?? this.logRepo;
    const rows = changes
      .filter((c) => (c.previousValue ?? null) !== (c.newValue ?? null))
      .map((c) =>
        repository.create({
          partnerId,
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

  async listForPartner(
    partnerId: number,
    page = 0,
    size = 6,
  ): Promise<BookingPartnerFieldChangePage> {
    const safePage = Math.max(0, page);
    const safeSize = Math.min(50, Math.max(1, size));

    const [rows, totalElements] = await this.logRepo.findAndCount({
      where: { partnerId },
      relations: { changedBy: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: safePage * safeSize,
      take: safeSize,
    });

    const totalPages =
      totalElements === 0 ? 0 : Math.ceil(totalElements / safeSize);

    return {
      content: rows.map((row) => ({
        id: row.id,
        partnerId: row.partnerId,
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
      })),
      totalElements,
      totalPages,
      size: safeSize,
      number: safePage,
    };
  }
}
