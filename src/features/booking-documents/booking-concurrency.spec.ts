import { ConflictException } from '@nestjs/common';
import { OptimisticLockVersionMismatchError } from 'typeorm';
import { BookingDocumentRecordService } from './booking-document-record.service';
import { BookingDocumentType } from './enums/booking-document-type.enum';
import { mapOptimisticLockError, saveWithOptimisticLock } from '../../shared/utils/optimistic-lock';
import { BookingPartnerService } from '../booking/services/booking-partner.service';
import { BookingPartner } from '../booking/entities/booking-partner.entity';

describe('CONC-01 optimistic concurrency', () => {
  it('maps OptimisticLockVersionMismatchError to HTTP 409 ConflictException', () => {
    expect(() =>
      mapOptimisticLockError(
        new OptimisticLockVersionMismatchError('BookingPartner', 1, 2),
      ),
    ).toThrow(ConflictException);
  });

  it('saveWithOptimisticLock surfaces concurrent document writers as 409', async () => {
    await expect(
      saveWithOptimisticLock(
        () =>
          Promise.reject(
            new OptimisticLockVersionMismatchError('ArrivalNoticeRecord', 3, 4),
          ),
        'Document record was modified concurrently; reload and retry',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('document update returns 409 when the version check fails', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue({
        id: 10,
        payload: { anNumber: 'AN-1' },
        status: 'PROCESSING',
        lockedAt: null,
        deletedAt: null,
        version: 1,
        createdByUserId: 1,
        createdAt: new Date('2026-08-07T00:00:00.000Z'),
        updatedAt: new Date('2026-08-07T00:00:00.000Z'),
      }),
      save: jest
        .fn()
        .mockRejectedValue(
          new OptimisticLockVersionMismatchError('ArrivalNoticeRecord', 1, 2),
        ),
      create: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      remove: jest.fn(),
    };
    const service = new BookingDocumentRecordService(
      repository as never,
      repository as never,
      repository as never,
      repository as never,
    );

    await expect(
      service.update(
        BookingDocumentType.ARRIVAL_NOTICE,
        10,
        { anNumber: 'AN-2', containers: [], cargoRows: [], descriptionOfGoods: '' },
        9,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'Document record was modified concurrently; reload and retry',
      }),
    });
  });

  it('partner lock CAS: only one concurrent lock wins (loser 409)', async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 0 });
    const updateBuilder = {
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute,
    };
    const lockedRow = {
      id: 42,
      lockedAt: new Date('2026-08-07T12:00:00.000Z'),
      version: 2,
      name: 'Acme',
      customerId: 'C-1',
      additionTypeRows: [],
      contacts: [],
      deletedAt: null,
    };
    const repository = {
      findOne: jest.fn().mockResolvedValue(lockedRow),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn(() => updateBuilder),
      })),
      save: jest.fn(),
    };
    const manager = {
      getRepository: jest.fn(() => repository),
    };
    const dataSource = {
      transaction: jest.fn(async (work: (m: typeof manager) => Promise<unknown>) =>
        work(manager),
      ),
    };
    const fieldChangeService = {
      logFieldChanges: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BookingPartnerService(
      repository as never,
      dataSource as never,
      fieldChangeService as never,
    );

    const winner = await service.lockPartner(42, 'alice', 1);
    expect(winner.lockedAt).toEqual(lockedRow.lockedAt);

    repository.findOne.mockResolvedValue({
      ...lockedRow,
      lockedAt: new Date('2026-08-07T12:00:00.000Z'),
    });
    await expect(service.lockPartner(42, 'bob', 2)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('partner update returns 409 on optimistic version mismatch', async () => {
    const row = Object.assign(new BookingPartner(), {
      id: 7,
      name: 'Acme',
      customerId: 'C-7',
      additionTypeRows: [],
      contacts: [],
      lockedAt: null,
      deletedAt: null,
      version: 1,
    });
    const repository = {
      findOne: jest.fn().mockResolvedValue(row),
      save: jest
        .fn()
        .mockRejectedValue(
          new OptimisticLockVersionMismatchError('BookingPartner', 1, 2),
        ),
    };
    const manager = {
      getRepository: jest.fn(() => repository),
    };
    const dataSource = {
      transaction: jest.fn(async (work: (m: typeof manager) => Promise<unknown>) =>
        work(manager),
      ),
    };
    const service = new BookingPartnerService(
      repository as never,
      dataSource as never,
      { logFieldChanges: jest.fn() } as never,
    );

    await expect(
      service.updatePartner(
        7,
        { name: 'Acme Updated', additionTypes: [] },
        'alice',
        1,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
