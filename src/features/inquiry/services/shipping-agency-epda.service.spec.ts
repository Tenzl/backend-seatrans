import { BadRequestException, ConflictException } from '@nestjs/common';
import { ShippingAgencyEpdaService } from './shipping-agency-epda.service';
import { InquiryStatus } from '../enums/inquiry-status.enum';
import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';
import { User } from '../../auth/entities/user.entity';

function queryBuilder(result: unknown) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
    getRawOne: jest.fn().mockResolvedValue(null),
  };
}

describe('ShippingAgencyEpdaService increment 1', () => {
  const serviceType = {
    id: 7,
    name: 'Shipping Agency',
    displayName: 'Shipping Agency',
  };
  const customer = {
    id: 10,
    fullName: 'Customer',
    email: 'customer@example.com',
    phone: '0900',
    company: 'Customer Co',
  };
  const actor = { id: 99 };

  function setup(existingInquiry?: Record<string, unknown>) {
    const events: string[] = [];
    const saveResult = (value: Record<string, unknown>) =>
      Promise.resolve({
        id: 1,
        submittedAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        serviceType,
        userId: customer.id,
        ...value,
      });
    const lockedQueryBuilder = queryBuilder(existingInquiry);
    const transactionalRepository = {
      createQueryBuilder: jest.fn(() => lockedQueryBuilder),
      create: jest.fn((value: Record<string, unknown>) => value),
      save: jest.fn(saveResult),
    };
    const transactionalUserRepository = {
      findOne: jest.fn(({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === customer.id ? customer : actor),
      ),
    };
    const transactionManager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === ShippingAgencyInquiryEntity) {
          return transactionalRepository;
        }
        if (entity === User) {
          return transactionalUserRepository;
        }
        throw new Error('Unexpected transaction repository');
      }),
      query: jest.fn().mockResolvedValue(undefined),
    };
    const transaction = jest.fn(
      async (
        work: (manager: typeof transactionManager) => Promise<unknown>,
      ) => {
        events.push('transaction:start');
        try {
          const result = await work(transactionManager);
          events.push('transaction:commit');
          return result;
        } catch (error) {
          events.push('transaction:rollback');
          throw error;
        }
      },
    );
    const inquiryRepository = {
      create: jest.fn((value: Record<string, unknown>) => value),
      save: jest.fn(saveResult),
      findOne: jest.fn().mockResolvedValue(existingInquiry),
      createQueryBuilder: jest.fn(() => queryBuilder(null)),
      manager: { transaction },
    };
    const serviceTypeRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder(serviceType)),
    };
    const userRepository = {
      findOne: jest.fn(({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === customer.id ? customer : actor),
      ),
    };
    const notificationService = {
      notifyCustomerFieldChanges: jest.fn(() => {
        events.push('notification:customer-fields');
      }),
      notifyStatusChanged: jest.fn(() => {
        events.push('notification:status');
      }),
      notifyInquiryQuotedIfNeeded: jest.fn(() => {
        events.push('notification:quoted');
      }),
    };
    const fieldChangeService = {
      logFieldChanges: jest.fn(() => {
        events.push('audit');
        return Promise.resolve();
      }),
    };
    const portRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 21,
        portOfCall: 'HAI PHONG',
        province: { area: 1 },
      }),
    };
    const service = new ShippingAgencyEpdaService(
      inquiryRepository as never,
      serviceTypeRepository as never,
      userRepository as never,
      portRepository as never,
      notificationService as never,
      fieldChangeService as never,
    );
    return {
      service,
      inquiryRepository,
      transactionalRepository,
      lockedQueryBuilder,
      transaction,
      portRepository,
      userRepository,
      notificationService,
      fieldChangeService,
      transactionManager,
      transactionalUserRepository,
      events,
    };
  }

  it('persists the complete create payload including canonical portId', async () => {
    const { service, inquiryRepository, transactionalRepository } = setup();

    await service.createInternalInquiry(
      {
        customerUserId: customer.id,
        shipownerTo: 'Owner',
        vesselName: 'MV Test',
        portId: 21,
        portOfCall: 'HAI PHONG',
        dischargeLoadingLocation: 'BERTH',
        quoteForm: 'HN',
        cargoNameOther: 'Project cargo',
        quantityTons: 1250,
        boatHireAmount: 100,
        tallyFeeAmount: 200,
        tugAssistanceAmount: 300,
        transportLs: 'Taxi',
        transportQuarantine: 'Launch',
      },
      actor.id,
    );

    expect(transactionalRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        portId: 21,
        cargoNameOther: 'Project cargo',
        cargoQuantity: '1250',
        boatHireAmount: '100',
        tallyFeeAmount: '200',
        tugAssistanceAmount: '300',
        transportLs: 'Taxi',
        transportQuarantine: 'Launch',
      }),
    );
    expect(inquiryRepository.create).not.toHaveBeenCalled();
  });

  it('persists a partial create as PROCESSING with nullable vessel fields', async () => {
    const { service, transactionalRepository } = setup();

    await service.createInternalInquiry(
      {
        customerUserId: customer.id,
        portId: 21,
        isComplete: false,
      },
      actor.id,
    );

    expect(transactionalRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: InquiryStatus.PROCESSING,
        toName: null,
        mv: null,
        dischargeLoadingLocation: null,
      }),
    );
  });

  it('rejects a complete create with missing required vessel fields', async () => {
    const { service, transactionalRepository } = setup();

    await expect(
      service.createInternalInquiry(
        {
          customerUserId: customer.id,
          portId: 21,
          isComplete: true,
        },
        actor.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactionalRepository.save).not.toHaveBeenCalled();
  });

  it('rejects a canonical port paired with the wrong quote form', async () => {
    const { service, portRepository } = setup();
    portRepository.findOne.mockResolvedValue({
      id: 21,
      portOfCall: 'CAT LAI',
      province: { area: 3 },
    });

    await expect(
      service.createInternalInquiry(
        {
          customerUserId: customer.id,
          shipownerTo: 'Owner',
          vesselName: 'MV Test',
          portId: 21,
          portOfCall: 'CAT LAI',
          dischargeLoadingLocation: 'BERTH',
          quoteForm: 'HN',
        },
        actor.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('derives canonical portOfCall and quoteForm from required portId', async () => {
    const { service, inquiryRepository, transactionalRepository } = setup();

    await service.createInternalInquiry(
      {
        customerUserId: customer.id,
        shipownerTo: 'Owner',
        vesselName: 'MV Test',
        portId: 21,
        dischargeLoadingLocation: 'BERTH',
      },
      actor.id,
    );

    expect(transactionalRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        portId: 21,
        portOfCall: 'HAI PHONG',
        quoteForm: 'HN',
      }),
    );
    expect(inquiryRepository.create).not.toHaveBeenCalled();
  });

  it('takes the inquiry-code advisory lock before allocating the next code', async () => {
    const {
      service,
      inquiryRepository,
      transactionalRepository,
      transactionManager,
    } = setup();

    await service.createInternalInquiry(
      {
        customerUserId: customer.id,
        shipownerTo: 'Owner',
        vesselName: 'MV Test',
        portId: 21,
        dischargeLoadingLocation: 'BERTH',
      },
      actor.id,
    );

    expect(transactionManager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['shipping-agency-inquiry-code'],
    );
    expect(transactionManager.query.mock.invocationCallOrder[0]).toBeLessThan(
      transactionalRepository.createQueryBuilder.mock.invocationCallOrder[0],
    );
    expect(inquiryRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('rolls back create when the mandatory creation audit fails', async () => {
    const {
      service,
      inquiryRepository,
      userRepository,
      transactionalRepository,
      transactionalUserRepository,
      fieldChangeService,
      transactionManager,
      events,
    } = setup();
    fieldChangeService.logFieldChanges.mockRejectedValueOnce(
      new Error('audit insert failed'),
    );

    await expect(
      service.createInternalInquiry(
        {
          customerUserId: customer.id,
          shipownerTo: 'Owner',
          vesselName: 'MV Test',
          portId: 21,
          dischargeLoadingLocation: 'BERTH',
        },
        actor.id,
      ),
    ).rejects.toThrow('audit insert failed');

    expect(transactionalRepository.save).toHaveBeenCalledTimes(1);
    expect(fieldChangeService.logFieldChanges).toHaveBeenCalledWith(
      1,
      actor.id,
      expect.any(String),
      expect.any(Array),
      transactionManager,
    );
    expect(transactionalUserRepository.findOne).toHaveBeenCalledWith({
      where: { id: actor.id },
    });
    expect(userRepository.findOne).toHaveBeenCalledTimes(1);
    expect(inquiryRepository.save).not.toHaveBeenCalled();
    expect(events).toContain('transaction:rollback');
    expect(events).not.toContain('transaction:commit');
  });

  it('rejects issuing a different snapshot after the EPDA is locked', async () => {
    const lockedSnapshot = { params: { clearanceFee: 50 } };
    const { service, inquiryRepository } = setup({
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      epdaSnapshot: lockedSnapshot,
      epdaLockedAt: new Date('2026-01-01T00:00:00Z'),
      status: InquiryStatus.COMPLETED,
    });

    await expect(
      service.issueEpdaToCustomer(
        1,
        { epdaSnapshot: { params: { clearanceFee: 99 } } },
        actor.id,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(inquiryRepository.save).not.toHaveBeenCalled();
    expect(lockedSnapshot).toEqual({ params: { clearanceFee: 50 } });
  });

  it('preserves explicit null clears when updating a draft', async () => {
    const existing = {
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      epdaLockedAt: null,
      portId: 21,
      boatHireAmount: '100',
      transportLs: 'Taxi',
      status: InquiryStatus.PROCESSING,
    };
    const {
      service,
      transactionalRepository,
      lockedQueryBuilder,
      transaction,
    } = setup(existing);

    await service.updateEpda(
      1,
      {
        portId: null,
        boatHireAmount: null,
        transportLs: null,
        berthHours: null,
        anchorageHours: null,
        pilotage3rdMiles: null,
      },
      actor.id,
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(lockedQueryBuilder.setLock).toHaveBeenCalledWith(
      'pessimistic_write',
    );
    expect(transactionalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        portId: null,
        boatHireAmount: null,
        transportLs: null,
        berthHours: null,
        anchorageHours: null,
        pilotage3rdMiles: null,
      }),
    );
  });

  it('issues an already locked EPDA only when the frozen snapshot is unchanged', async () => {
    const lockedSnapshot = {
      params: { clearanceFee: 50, nested: { rate: 1 } },
    };
    const existing = {
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      epdaSnapshot: lockedSnapshot,
      epdaLockedAt: new Date('2026-01-01T00:00:00Z'),
      status: InquiryStatus.COMPLETED,
    };
    const {
      service,
      transactionalRepository,
      lockedQueryBuilder,
      transaction,
      events,
    } = setup(existing);

    await service.issueEpdaToCustomer(
      1,
      { epdaSnapshot: { params: { nested: { rate: 1 }, clearanceFee: 50 } } },
      actor.id,
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(lockedQueryBuilder.setLock).toHaveBeenCalledWith(
      'pessimistic_write',
    );
    expect(transactionalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ epdaSnapshot: lockedSnapshot }),
    );
    expect(events.indexOf('transaction:commit')).toBeLessThan(
      events.indexOf('notification:status'),
    );
    expect(events.indexOf('transaction:commit')).toBeLessThan(
      events.indexOf('notification:quoted'),
    );
  });

  it('serializes lock attempts behind a pessimistic row lock', async () => {
    const existing = {
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      epdaSnapshot: null,
      epdaLockedAt: null,
      status: InquiryStatus.COMPLETED,
    };
    const {
      service,
      transaction,
      lockedQueryBuilder,
      transactionalRepository,
    } = setup(existing);

    await service.lockEpda(
      1,
      { epdaSnapshot: { params: { rate: 1 } } },
      actor.id,
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(lockedQueryBuilder.setLock).toHaveBeenCalledWith(
      'pessimistic_write',
    );
    expect(transactionalRepository.save).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale draft update after the transaction re-reads a locked EPDA', async () => {
    const existing = {
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      epdaSnapshot: { params: { rate: 1 } },
      epdaLockedAt: new Date('2026-01-01T00:00:00Z'),
      vesselName: 'MV Frozen',
      status: InquiryStatus.COMPLETED,
    };
    const { service, lockedQueryBuilder, transactionalRepository } =
      setup(existing);

    await expect(
      service.updateEpda(1, { vesselName: 'MV Stale Update' }, actor.id),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(lockedQueryBuilder.setLock).toHaveBeenCalledWith(
      'pessimistic_write',
    );
    expect(transactionalRepository.save).not.toHaveBeenCalled();
  });

  it('lets the first serialized lock win and rejects a second snapshot', async () => {
    const existing = {
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      epdaSnapshot: null,
      epdaLockedAt: null,
      status: InquiryStatus.COMPLETED,
    };
    const { service, transaction, transactionalRepository } = setup(existing);

    await service.lockEpda(
      1,
      { epdaSnapshot: { params: { rate: 1 } } },
      actor.id,
    );
    await expect(
      service.lockEpda(1, { epdaSnapshot: { params: { rate: 99 } } }, actor.id),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transactionalRepository.save).toHaveBeenCalledTimes(1);
    expect(existing.epdaSnapshot).toEqual({ params: { rate: 1 } });
  });

  it('writes audit through the transaction manager and notifies only after commit', async () => {
    const existing = {
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      epdaLockedAt: null,
      status: InquiryStatus.PROCESSING,
    };
    const {
      service,
      fieldChangeService,
      transactionManager,
      notificationService,
      events,
    } = setup(existing);

    await service.updateEpda(
      1,
      {
        confirmedCustomerFieldChanges: [
          { field: 'loa', previousValue: '100', newValue: '101' },
        ],
      },
      actor.id,
    );

    expect(fieldChangeService.logFieldChanges).toHaveBeenCalledWith(
      expect.any(Number),
      actor.id,
      expect.any(String),
      expect.any(Array),
      transactionManager,
    );
    expect(notificationService.notifyCustomerFieldChanges).toHaveBeenCalled();
    expect(events.indexOf('transaction:commit')).toBeLessThan(
      events.indexOf('notification:customer-fields'),
    );
  });

  it('keeps a committed EPDA mutation successful when post-commit notification fails', async () => {
    const existing = {
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      epdaLockedAt: null,
      status: InquiryStatus.PROCESSING,
    };
    const { service, notificationService, transactionalRepository } =
      setup(existing);
    (
      notificationService.notifyCustomerFieldChanges as jest.Mock
    ).mockRejectedValueOnce(new Error('notification database unavailable'));

    await expect(
      service.updateEpda(
        1,
        {
          confirmedCustomerFieldChanges: [
            { field: 'loa', previousValue: '100', newValue: '101' },
          ],
        },
        actor.id,
      ),
    ).resolves.toBeDefined();
    expect(transactionalRepository.save).toHaveBeenCalledTimes(1);
  });
});
