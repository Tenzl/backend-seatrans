import { ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BookingPartner } from '../entities/booking-partner.entity';
import { BookingPartnerService } from './booking-partner.service';

describe('BookingPartnerService destructive operations', () => {
  function setup(actualCount: number) {
    const partnerRepository = {
      findOne: jest.fn(),
      remove: jest.fn(),
    };
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: actualCount }])
        .mockResolvedValueOnce([{ isReferenced: false }])
        .mockResolvedValueOnce([]),
    };
    const dataSource = {
      transaction: jest.fn(
        async (work: (value: typeof manager) => Promise<unknown>) =>
          work(manager),
      ),
    };
    const service = new BookingPartnerService(
      partnerRepository as unknown as Repository<BookingPartner>,
      dataSource as unknown as DataSource,
      {
        logFieldChanges: jest.fn(),
        listForPartner: jest.fn(),
      } as never,
    );
    return { dataSource, manager, partnerRepository, service };
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
      4,
      'TRUNCATE TABLE booking_partners RESTART IDENTITY CASCADE',
    );
    expect(manager.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining(
        "NULLIF(payload ->> 'clientPartyId', '') IS NOT NULL",
      ),
      [null],
    );
  });

  it('rejects a stale confirmation count without truncating', async () => {
    const { manager, service } = setup(13);

    await expect(service.deleteAll(12)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(manager.query).toHaveBeenCalledTimes(2);
  });

  it('rejects hard-delete when a saved document references the partner id', async () => {
    const { dataSource, partnerRepository, service } = setup(0);
    partnerRepository.findOne.mockResolvedValue({ id: 7 });
    (dataSource as unknown as { query: jest.Mock }).query = jest
      .fn()
      .mockResolvedValue([{ isReferenced: true }]);

    await expect(service.delete(7)).rejects.toBeInstanceOf(ConflictException);
    expect(partnerRepository.remove).not.toHaveBeenCalled();
  });
});
