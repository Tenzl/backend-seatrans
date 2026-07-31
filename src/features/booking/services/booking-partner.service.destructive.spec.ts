import { ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BookingPartner } from '../entities/booking-partner.entity';
import { BookingPartnerService } from './booking-partner.service';

describe('BookingPartnerService destructive operations', () => {
  function setup(actualCount: number) {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: actualCount }])
        .mockResolvedValueOnce([]),
    };
    const dataSource = {
      transaction: jest.fn(
        async (work: (value: typeof manager) => Promise<unknown>) =>
          work(manager),
      ),
    };
    const service = new BookingPartnerService(
      {} as Repository<BookingPartner>,
      dataSource as unknown as DataSource,
      {
        logFieldChanges: jest.fn(),
        listForPartner: jest.fn(),
      } as never,
    );
    return { dataSource, manager, service };
  }

  it('locks, verifies the expected count, then truncates transactionally', async () => {
    const { dataSource, manager, service } = setup(12);

    await expect(service.deleteAll(12)).resolves.toEqual({ deleted: 12 });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['seatrans:booking-partners:delete-all'],
    );
    expect(manager.query).toHaveBeenNthCalledWith(
      3,
      'TRUNCATE TABLE booking_partners RESTART IDENTITY CASCADE',
    );
  });

  it('rejects a stale confirmation count without truncating', async () => {
    const { manager, service } = setup(13);

    await expect(service.deleteAll(12)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(manager.query).toHaveBeenCalledTimes(2);
  });
});
