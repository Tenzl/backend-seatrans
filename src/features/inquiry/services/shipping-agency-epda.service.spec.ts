import { BadRequestException, ConflictException } from '@nestjs/common';
import { ShippingAgencyEpdaService } from './shipping-agency-epda.service';
import { InquiryStatus } from '../enums/inquiry-status.enum';
import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';
import { User } from '../../auth/entities/user.entity';
import { ServiceType } from '../../logistics/entities/service-type.entity';
import { Port } from '../../ports/entities/port.entity';
import { Commodity } from '../../commodities/entities/commodity.entity';
import { CommodityType } from '../../commodities/entities/commodity-type.entity';
import { ShippingAgencyEpdaSnapshotService } from './shipping-agency-epda-snapshot.service';
import { InquiryCodeAllocator } from './inquiry-code-allocator';
import { InquiryRepositoryRegistry } from './inquiry-repository.registry';
import { CharteringBrokerageInquiryEntity } from '../entities/chartering-brokerage-inquiry.entity';
import { FreightForwardingInquiryEntity } from '../entities/freight-forwarding-inquiry.entity';
import { TotalLogisticsInquiryEntity } from '../entities/total-logistics-inquiry.entity';
import { SpecialRequestInquiryEntity } from '../entities/special-request-inquiry.entity';
import type { Repository } from 'typeorm';
import { InquiryFieldChangeAction } from '../entities/inquiry-field-change-log.entity';

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
  const actor = {
    id: 99,
    fullName: 'Employee',
    email: 'employee@example.com',
    phone: '0911',
    company: 'Seatrans',
  };
  const completeEpdaFields = {
    toName: 'Owner',
    mv: 'MV Test',
    dischargeLoadingLocation: 'BERTH',
    dwt: '10000',
    grt: '8000',
    loa: '150',
    cargoQuantity: '1200',
    cargoType: 'IN_BULK',
    cargoName: 'RICE',
    purposeOfCalling: 'MUC_DICH_KHAC',
  };

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
        if (entity === ServiceType) {
          return serviceTypeRepository;
        }
        if (entity === Port) {
          return portRepository;
        }
        if (entity === Commodity) {
          return commodityRepository;
        }
        if (entity === CommodityType) {
          return commodityTypeRepository;
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
    const commodityRepository = {
      exists: jest.fn().mockResolvedValue(true),
      findOne: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: number } }) =>
          Promise.resolve(
            where.id === 202
              ? {
                  id: 202,
                  serviceTypeId: serviceType.id,
                  name: 'RICE',
                  displayName: 'Rice',
                }
              : null,
          ),
        ),
    };
    const commodityTypeRepository = {
      findOne: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: number } }) =>
          Promise.resolve(
            where.id === 101
              ? {
                  id: 101,
                  serviceTypeId: serviceType.id,
                  code: 'IN_BULK',
                  name: 'In bulk',
                }
              : null,
          ),
        ),
    };
    const effectiveParameters = {
      hours: { berthHours: 64 },
      coeff: { clearanceFee: 50, pilotageSingleRate: 0.0045 },
    };
    const epdaParametersService = {
      getEffective: jest.fn().mockResolvedValue(effectiveParameters),
    };
    const repositories = new InquiryRepositoryRegistry(
      inquiryRepository as unknown as Repository<ShippingAgencyInquiryEntity>,
      {} as Repository<CharteringBrokerageInquiryEntity>,
      {} as Repository<FreightForwardingInquiryEntity>,
      {} as Repository<TotalLogisticsInquiryEntity>,
      {} as Repository<SpecialRequestInquiryEntity>,
    );
    const service = new ShippingAgencyEpdaService(
      inquiryRepository as never,
      serviceTypeRepository as never,
      userRepository as never,
      portRepository as never,
      fieldChangeService as never,
      new ShippingAgencyEpdaSnapshotService(epdaParametersService as never),
      new InquiryCodeAllocator(),
      repositories,
    );
    return {
      service,
      inquiryRepository,
      transactionalRepository,
      lockedQueryBuilder,
      transaction,
      portRepository,
      commodityRepository,
      commodityTypeRepository,
      userRepository,
      fieldChangeService,
      transactionManager,
      transactionalUserRepository,
      events,
      epdaParametersService,
      effectiveParameters,
    };
  }

  it('persists the complete create payload including canonical portId', async () => {
    const {
      service,
      inquiryRepository,
      transactionalRepository,
      effectiveParameters,
    } = setup();

    await service.createInternalInquiry(
      {
        shipownerTo: 'Owner',
        vesselName: 'MV Test',
        portId: 21,
        portOfCall: 'HAI PHONG',
        dischargeLoadingLocation: 'BERTH',
        quoteForm: 'HN',
        dwt: 10000,
        grt: 8000,
        loa: 150,
        cargoType: 'In bulk',
        cargoNameOther: 'Project cargo',
        purposeOfCalling: 'MUC_DICH_KHAC',
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
        user: actor,
        processedBy: actor,
        epdaWorkingParams: effectiveParameters,
        status: InquiryStatus.COMPLETED,
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

  it('resolves independent same-Service Type and Commodity IDs into name snapshots', async () => {
    const {
      service,
      transactionalRepository,
      commodityTypeRepository,
      commodityRepository,
    } = setup();

    const result = await service.createInternalInquiry(
      {
        portId: 21,
        commodityTypeId: 101,
        commodityId: 202,
      },
      actor.id,
    );

    expect(commodityTypeRepository.findOne).toHaveBeenCalledWith({
      where: { id: 101 },
    });
    expect(commodityRepository.findOne).toHaveBeenCalledWith({
      where: { id: 202 },
    });
    expect(transactionalRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        commodityTypeId: 101,
        commodityId: 202,
        cargoType: 'In bulk',
        cargoName: 'RICE',
      }),
    );
    expect(result).toMatchObject({ commodityTypeId: 101, commodityId: 202 });
  });

  it('uses the selected Type ID and snapshots its current name even when its legacy code is stale', async () => {
    const { service, commodityTypeRepository, transactionalRepository } =
      setup();
    commodityTypeRepository.findOne.mockResolvedValue({
      id: 101,
      serviceTypeId: serviceType.id,
      code: 'IN_BULK',
      name: 'Project and breakbulk cargo',
    });

    await service.createInternalInquiry(
      {
        portId: 21,
        commodityTypeId: 101,
        cargoType: 'IN_BULK',
      },
      actor.id,
    );

    expect(transactionalRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        commodityTypeId: 101,
        cargoType: 'Project and breakbulk cargo',
      }),
    );
  });

  it('preserves a backfilled inquiry legacy cargo_type snapshot on unrelated updates', async () => {
    const existing = {
      id: 1,
      serviceType,
      serviceTypeId: serviceType.id,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      epdaLockedAt: null,
      status: InquiryStatus.PROCESSING,
      cargoType: 'IN_BULK',
      cargoName: 'RICE',
      commodityTypeId: 101,
      commodityId: 202,
      toName: 'Legacy owner',
    };
    const { service, commodityTypeRepository, transactionalRepository } =
      setup(existing);

    const result = await service.updateEpda(
      1,
      { shipownerTo: 'Updated owner' },
      actor.id,
    );

    expect(commodityTypeRepository.findOne).not.toHaveBeenCalled();
    expect(transactionalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        commodityTypeId: 101,
        cargoType: 'IN_BULK',
        toName: 'Updated owner',
      }),
    );
    expect(result).toMatchObject({
      commodityTypeId: 101,
      cargoType: 'IN_BULK',
    });
  });

  it('preserves legacy string-only OTHER handling without catalog lookups', async () => {
    const {
      service,
      transactionalRepository,
      commodityTypeRepository,
      commodityRepository,
    } = setup();

    await service.createInternalInquiry(
      {
        portId: 21,
        cargoType: 'IN_EQUIPMENT',
        cargoName: 'OTHER',
        cargoNameOther: 'Project cargo',
      },
      actor.id,
    );

    expect(commodityTypeRepository.findOne).not.toHaveBeenCalled();
    expect(commodityRepository.findOne).not.toHaveBeenCalled();
    expect(transactionalRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        commodityTypeId: null,
        commodityId: null,
        cargoType: 'IN_EQUIPMENT',
        cargoName: 'OTHER',
        cargoNameOther: 'Project cargo',
      }),
    );
  });

  it('rejects a Commodity Type from another Service independently', async () => {
    const { service, commodityTypeRepository, transactionalRepository } =
      setup();
    commodityTypeRepository.findOne.mockResolvedValue({
      id: 101,
      serviceTypeId: 88,
      code: 'IN_BULK',
      name: 'In bulk',
    });

    await expect(
      service.createInternalInquiry(
        { portId: 21, commodityTypeId: 101 },
        actor.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactionalRepository.save).not.toHaveBeenCalled();
  });

  it('rejects a Commodity from another Service independently', async () => {
    const { service, commodityRepository, transactionalRepository } = setup();
    commodityRepository.findOne.mockResolvedValue({
      id: 202,
      serviceTypeId: 88,
      name: 'RICE',
      displayName: 'Rice',
    });

    await expect(
      service.createInternalInquiry({ portId: 21, commodityId: 202 }, actor.id),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactionalRepository.save).not.toHaveBeenCalled();
  });

  it('updates independent IDs without requiring a Type-Commodity pairing', async () => {
    const existing = {
      id: 1,
      serviceType,
      serviceTypeId: serviceType.id,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      epdaLockedAt: null,
      status: InquiryStatus.PROCESSING,
      cargoType: 'LEGACY TYPE',
      cargoName: 'LEGACY CARGO',
      commodityTypeId: null,
      commodityId: null,
    };
    const { service, transactionalRepository } = setup(existing);

    const result = await service.updateEpda(
      1,
      { commodityTypeId: 101, commodityId: 202 },
      actor.id,
    );

    expect(transactionalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        commodityTypeId: 101,
        commodityId: 202,
        cargoType: 'In bulk',
        cargoName: 'RICE',
      }),
    );
    expect(result).toMatchObject({ commodityTypeId: 101, commodityId: 202 });
  });

  it('persists a partial create as PROCESSING with nullable vessel fields', async () => {
    const { service, transactionalRepository } = setup();

    await service.createInternalInquiry(
      {
        portId: 21,
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

  it('derives incomplete create status on the server', async () => {
    const { service, transactionalRepository } = setup();

    await service.createInternalInquiry({ portId: 21 }, actor.id);

    expect(transactionalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: InquiryStatus.PROCESSING }),
    );
  });

  it('does not require cargo name when its cargo type has no catalog options', async () => {
    const { service, commodityRepository, transactionalRepository } = setup();
    commodityRepository.exists.mockResolvedValue(false);

    await service.createInternalInquiry(
      {
        portId: 21,
        shipownerTo: 'Owner',
        vesselName: 'MV Test',
        dischargeLoadingLocation: 'BERTH',
        dwt: 10000,
        grt: 8000,
        loa: 150,
        quantityTons: 1200,
        cargoType: 'IN_BULK',
        purposeOfCalling: 'MUC_DICH_KHAC',
      },
      actor.id,
    );

    expect(transactionalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: InquiryStatus.COMPLETED }),
    );
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
        shipownerTo: 'Owner',
        vesselName: 'MV Test',
        portId: 21,
        dischargeLoadingLocation: 'BERTH',
      },
      actor.id,
    );

    expect(transactionManager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [expect.stringMatching(/^inquiry-code:SA-\d{4}-$/)],
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
    expect(userRepository.findOne).not.toHaveBeenCalled();
    expect(inquiryRepository.save).not.toHaveBeenCalled();
    expect(events).toContain('transaction:rollback');
    expect(events).not.toContain('transaction:commit');
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
      undefined,
      ['inquiry'],
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

  it('derives update status from saved fields', async () => {
    const existing = {
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      epdaLockedAt: null,
      epdaWorkingParams: null,
      portId: 21,
      status: InquiryStatus.PROCESSING,
    };
    const { service, transactionalRepository } = setup(existing);

    await service.updateEpda(1, {}, actor.id);

    expect(transactionalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: InquiryStatus.PROCESSING }),
    );
  });

  it('rejects arbitrary client working parameters on draft save', async () => {
    const existing = {
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      epdaLockedAt: null,
      epdaWorkingParams: { coeff: { clearanceFee: 50 } },
      portId: 21,
      status: InquiryStatus.PROCESSING,
    };
    const { service, transactionalRepository } = setup(existing);

    await expect(
      service.updateEpda(
        1,
        { epdaWorkingParams: { coeff: { clearanceFee: 999 } } },
        actor.id,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transactionalRepository.save).not.toHaveBeenCalled();
  });

  it('invalidates pinned working parameters when port changes', async () => {
    const pinned = { coeff: { clearanceFee: 50 } };
    const existing = {
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      epdaLockedAt: null,
      epdaWorkingParams: pinned,
      portId: 21,
      portOfCall: 'HAI PHONG',
      quoteForm: 'HN',
      status: InquiryStatus.PROCESSING,
    };
    const {
      service,
      portRepository,
      transactionalRepository,
      effectiveParameters,
    } = setup(existing);
    portRepository.findOne.mockResolvedValue({
      id: 22,
      portOfCall: 'HAI PHONG',
      province: { area: 1 },
    });

    await service.updateEpda(1, { portId: 22 }, actor.id);

    expect(transactionalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        portId: 22,
        epdaWorkingParams: effectiveParameters,
      }),
    );
  });

  it('rejects locking an incomplete EPDA even when status says completed', async () => {
    const existing = {
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      portId: 21,
      epdaSnapshot: null,
      epdaLockedAt: null,
      status: InquiryStatus.COMPLETED,
    };
    const { service, transactionalRepository, effectiveParameters } =
      setup(existing);

    await expect(
      service.lockEpda(
        1,
        { epdaSnapshot: { params: effectiveParameters } },
        actor.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactionalRepository.save).not.toHaveBeenCalled();
  });

  it.each(['dwt', 'grt', 'loa', 'cargoQuantity'] as const)(
    'rejects locking an EPDA when required positive field %s is zero',
    async (field) => {
      const existing = {
        ...completeEpdaFields,
        [field]: '0',
        id: 1,
        serviceType,
        user: customer,
        userId: customer.id,
        processedById: actor.id,
        portId: 21,
        epdaSnapshot: null,
        epdaLockedAt: null,
        status: InquiryStatus.COMPLETED,
      };
      const { service, transactionalRepository, effectiveParameters } =
        setup(existing);

      await expect(
        service.lockEpda(
          1,
          { epdaSnapshot: { params: effectiveParameters } },
          actor.id,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transactionalRepository.save).not.toHaveBeenCalled();
    },
  );

  it('serializes lock attempts behind a pessimistic row lock', async () => {
    const existing = {
      ...completeEpdaFields,
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      portId: 21,
      epdaSnapshot: null,
      epdaLockedAt: null,
      status: InquiryStatus.COMPLETED,
    };
    const {
      service,
      transaction,
      lockedQueryBuilder,
      transactionalRepository,
      effectiveParameters,
    } = setup(existing);

    await service.lockEpda(
      1,
      {
        epdaSnapshot: {
          params: effectiveParameters,
          grand_total: 1234,
        },
      },
      actor.id,
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(lockedQueryBuilder.setLock).toHaveBeenCalledWith(
      'pessimistic_write',
      undefined,
      ['inquiry'],
    );
    expect(transactionalRepository.save).toHaveBeenCalledTimes(1);
    expect(transactionalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        epdaSnapshot: {
          params: {
            hours: { berthHours: 64 },
            coeff: { clearanceFee: 50, pilotageSingleRate: 0.0045 },
          },
          grand_total: 1234,
        },
      }),
    );
  });

  it('resolves effective tariff params before acquiring the inquiry row lock', async () => {
    const existing = {
      ...completeEpdaFields,
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      portId: 21,
      epdaSnapshot: null,
      epdaLockedAt: null,
      status: InquiryStatus.COMPLETED,
    };
    const {
      service,
      lockedQueryBuilder,
      epdaParametersService,
      effectiveParameters,
      transactionManager,
    } = setup(existing);

    let sequence = 0;
    let getEffectiveOrder = 0;
    let lockOrder = 0;
    epdaParametersService.getEffective.mockImplementation(() => {
      getEffectiveOrder = ++sequence;
      return Promise.resolve(effectiveParameters);
    });
    lockedQueryBuilder.setLock.mockImplementation(() => {
      lockOrder = ++sequence;
      return lockedQueryBuilder;
    });

    await service.lockEpda(
      1,
      { epdaSnapshot: { params: effectiveParameters } },
      actor.id,
    );

    expect(epdaParametersService.getEffective).toHaveBeenCalledTimes(1);
    expect(epdaParametersService.getEffective).toHaveBeenCalledWith(
      undefined,
      21,
    );
    expect(getEffectiveOrder).toBeGreaterThan(0);
    expect(lockOrder).toBeGreaterThan(0);
    expect(getEffectiveOrder).toBeLessThan(lockOrder);
    expect(transactionManager.getRepository).toHaveBeenCalledWith(ServiceType);
  });

  it('loads ports through the transaction manager during a locked draft update', async () => {
    const existing = {
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      epdaLockedAt: null,
      portId: 21,
      portOfCall: 'HAI PHONG',
      quoteForm: 'HN',
      status: InquiryStatus.PROCESSING,
    };
    const { service, transactionManager, portRepository } = setup(existing);

    await service.updateEpda(
      1,
      {
        portId: 21,
        portOfCall: 'HAI PHONG',
        quoteForm: 'HN',
      },
      actor.id,
    );

    expect(transactionManager.getRepository).toHaveBeenCalledWith(Port);
    expect(transactionManager.getRepository).toHaveBeenCalledWith(ServiceType);
    expect(portRepository.findOne).toHaveBeenCalledWith({
      where: { id: 21 },
      relations: { province: true },
    });
  });

  it('locks with Skip when params match pinned working set (even if live differs)', async () => {
    const pinnedParams = {
      hours: { berthHours: 48 },
      coeff: { clearanceFee: 49, pilotageSingleRate: 0.003 },
    };
    const existing = {
      ...completeEpdaFields,
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      portId: 21,
      epdaSnapshot: null,
      epdaWorkingParams: pinnedParams,
      epdaLockedAt: null,
      status: InquiryStatus.COMPLETED,
    };
    const { service, transactionalRepository, effectiveParameters } =
      setup(existing);

    await service.lockEpda(
      1,
      {
        epdaSnapshot: {
          params: pinnedParams,
          grand_total: 900,
        },
      },
      actor.id,
    );

    expect(transactionalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        epdaSnapshot: {
          params: pinnedParams,
          grand_total: 900,
        },
        epdaLockedAt: expect.any(Date) as Date,
      }),
    );
    // Skip freezes working params; live effective must not overwrite them.
    expect(effectiveParameters).not.toEqual(pinnedParams);
  });

  it('locks with Apply when params match current effective parameters', async () => {
    const existing = {
      ...completeEpdaFields,
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      portId: 21,
      epdaSnapshot: null,
      epdaWorkingParams: {
        hours: { berthHours: 48 },
        coeff: { clearanceFee: 49, pilotageSingleRate: 0.003 },
      },
      epdaLockedAt: null,
      status: InquiryStatus.COMPLETED,
    };
    const { service, transactionalRepository, effectiveParameters } =
      setup(existing);

    await service.lockEpda(
      1,
      {
        epdaSnapshot: {
          params: effectiveParameters,
          grand_total: 1500,
        },
      },
      actor.id,
    );

    expect(transactionalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        epdaSnapshot: {
          params: effectiveParameters,
          grand_total: 1500,
        },
        epdaLockedAt: expect.any(Date) as Date,
      }),
    );
  });

  it('rejects lock with arbitrary params that match neither working nor live (409)', async () => {
    const existing = {
      ...completeEpdaFields,
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      portId: 21,
      epdaSnapshot: null,
      epdaWorkingParams: {
        hours: { berthHours: 48 },
        coeff: { clearanceFee: 49, pilotageSingleRate: 0.003 },
      },
      epdaLockedAt: null,
      status: InquiryStatus.COMPLETED,
    };
    const { service, transactionalRepository } = setup(existing);

    await expect(
      service.lockEpda(
        1,
        {
          epdaSnapshot: {
            params: {
              hours: { berthHours: 999 },
              coeff: { clearanceFee: 1, pilotageSingleRate: 0.1 },
            },
            grand_total: 1,
          },
        },
        actor.id,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transactionalRepository.save).not.toHaveBeenCalled();
  });

  it('rejects negative totals when locking a snapshot', async () => {
    const existing = {
      ...completeEpdaFields,
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      portId: 21,
      epdaSnapshot: null,
      epdaLockedAt: null,
      status: InquiryStatus.COMPLETED,
    };
    const { service, transactionalRepository } = setup(existing);

    await expect(
      service.lockEpda(
        1,
        { epdaSnapshot: { params: {}, grand_total: -1 } },
        actor.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transactionalRepository.save).not.toHaveBeenCalled();
  });

  it('rejects a stale draft update after the transaction re-reads a locked EPDA', async () => {
    const existing = {
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      portId: 21,
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
      undefined,
      ['inquiry'],
    );
    expect(transactionalRepository.save).not.toHaveBeenCalled();
  });

  it('lets the first serialized lock win and rejects a second snapshot', async () => {
    const existing = {
      ...completeEpdaFields,
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      portId: 21,
      epdaSnapshot: null,
      epdaLockedAt: null,
      status: InquiryStatus.COMPLETED,
    };
    const {
      service,
      transaction,
      transactionalRepository,
      effectiveParameters,
    } = setup(existing);

    await service.lockEpda(
      1,
      { epdaSnapshot: { params: effectiveParameters } },
      actor.id,
    );
    await expect(
      service.lockEpda(1, { epdaSnapshot: { params: { rate: 99 } } }, actor.id),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transactionalRepository.save).toHaveBeenCalledTimes(1);
    expect(existing.epdaSnapshot).toEqual({
      params: {
        hours: { berthHours: 64 },
        coeff: { clearanceFee: 50, pilotageSingleRate: 0.0045 },
      },
    });
  });

  it('unlocks a locked EPDA without changing its frozen snapshot', async () => {
    const snapshot = { params: { rate: 1 }, grand_total: 1234 };
    const lockedAt = new Date('2026-08-18T01:00:00.000Z');
    const existing = {
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      epdaLockedAt: lockedAt,
      epdaSnapshot: snapshot,
      status: InquiryStatus.COMPLETED,
    };
    const { service, transactionalRepository, fieldChangeService } =
      setup(existing);

    const result = await service.unlockEpda(1, actor.id);

    expect(transactionalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        epdaLockedAt: null,
        epdaSnapshot: snapshot,
      }),
    );
    expect(fieldChangeService.logFieldChanges).toHaveBeenCalledWith(
      1,
      actor.id,
      InquiryFieldChangeAction.EPDA_UNLOCK,
      [
        {
          field: 'EPDA locked',
          previousValue: String(lockedAt),
          newValue: null,
        },
      ],
      expect.anything(),
    );
    expect(result).toMatchObject({ epdaLockedAt: null });
  });

  it('writes audit through the transaction manager', async () => {
    const existing = {
      id: 1,
      serviceType,
      user: customer,
      userId: customer.id,
      processedById: actor.id,
      epdaLockedAt: null,
      status: InquiryStatus.PROCESSING,
    };
    const { service, fieldChangeService, transactionManager } = setup(existing);

    await service.updateEpda(1, { loa: 101 }, actor.id);

    expect(fieldChangeService.logFieldChanges).toHaveBeenCalledWith(
      expect.any(Number),
      actor.id,
      expect.any(String),
      expect.any(Array),
      transactionManager,
    );
  });
});
