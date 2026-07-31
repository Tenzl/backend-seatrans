import { ForbiddenException } from '@nestjs/common';
import type { EntityManager, EntityTarget, Repository } from 'typeorm';
import { ServiceInquiryService } from './service-inquiry.service';
import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';
import { CharteringBrokerageInquiryEntity } from '../entities/chartering-brokerage-inquiry.entity';
import { FreightForwardingInquiryEntity } from '../entities/freight-forwarding-inquiry.entity';
import { TotalLogisticsInquiryEntity } from '../entities/total-logistics-inquiry.entity';
import { SpecialRequestInquiryEntity } from '../entities/special-request-inquiry.entity';
import { InquiryFieldChangeLog } from '../entities/inquiry-field-change-log.entity';
import { ServiceType } from '../../logistics/entities/service-type.entity';
import { User } from '../../auth/entities/user.entity';
import { InquiryDocumentService } from './inquiry-document.service';
import { NotificationService } from '../../notification/notification.service';
import { InquiryRepositoryRegistry } from './inquiry-repository.registry';
import { InquiryQueryService } from './inquiry-query.service';

type RepositoryMock = {
  find: jest.Mock;
  findOne: jest.Mock;
  remove: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
  manager?: {
    transaction: jest.Mock;
  };
};

type SavedDeleteRow = {
  id: number;
  userId: number;
  deletedById: number | null;
  deletedAt: Date | null;
};

const repositoryMock = (): RepositoryMock => ({
  find: jest.fn(),
  findOne: jest.fn(),
  remove: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
});

describe('ServiceInquiryService user batch delete', () => {
  let shippingRepo: RepositoryMock;
  let charteringRepo: RepositoryMock;
  let transaction: jest.Mock;
  let transactionEvents: string[];
  let documentService: {
    removeMetadataByInquiry: jest.Mock;
    deleteStoredObjectsBestEffort: jest.Mock;
  };
  let service: ServiceInquiryService;

  beforeEach(() => {
    shippingRepo = repositoryMock();
    charteringRepo = repositoryMock();
    const freightRepo = repositoryMock();
    const logisticsRepo = repositoryMock();
    const specialRequestRepo = repositoryMock();
    const fieldChangeLogRepo = repositoryMock();
    transactionEvents = [];
    documentService = {
      removeMetadataByInquiry: jest.fn().mockResolvedValue([]),
      deleteStoredObjectsBestEffort: jest.fn().mockResolvedValue(undefined),
    };
    const repositoryByEntity = new Map<EntityTarget<unknown>, RepositoryMock>([
      [ShippingAgencyInquiryEntity, shippingRepo],
      [CharteringBrokerageInquiryEntity, charteringRepo],
      [FreightForwardingInquiryEntity, freightRepo],
      [TotalLogisticsInquiryEntity, logisticsRepo],
      [SpecialRequestInquiryEntity, specialRequestRepo],
      [InquiryFieldChangeLog, fieldChangeLogRepo],
    ]);
    const manager = {
      getRepository: jest.fn((entity: EntityTarget<unknown>) => {
        const repository = repositoryByEntity.get(entity);
        if (!repository) throw new Error('Unexpected repository');
        return repository;
      }),
    } as unknown as EntityManager;
    transaction = jest.fn(
      async (work: (transactionManager: EntityManager) => Promise<unknown>) => {
        transactionEvents.push('begin');
        const result = await work(manager);
        transactionEvents.push('commit');
        return result;
      },
    );
    shippingRepo.manager = { transaction };

    const repositories = new InquiryRepositoryRegistry(
      shippingRepo as unknown as Repository<ShippingAgencyInquiryEntity>,
      charteringRepo as unknown as Repository<CharteringBrokerageInquiryEntity>,
      freightRepo as unknown as Repository<FreightForwardingInquiryEntity>,
      logisticsRepo as unknown as Repository<TotalLogisticsInquiryEntity>,
      specialRequestRepo as unknown as Repository<SpecialRequestInquiryEntity>,
    );
    service = new ServiceInquiryService(
      repositories,
      new InquiryQueryService(repositories),
      repositoryMock() as unknown as Repository<ServiceType>,
      repositoryMock() as unknown as Repository<User>,
      documentService as unknown as InquiryDocumentService,
      {} as NotificationService,
    );
  });

  it('queries and deletes only the requested service for records owned by the user', async () => {
    const row = {
      id: 7,
      userId: 42,
      deletedAt: null,
      deletedById: null,
    };
    let savedRow: SavedDeleteRow | undefined;
    shippingRepo.find.mockResolvedValue([row]);
    shippingRepo.save.mockImplementation((value: SavedDeleteRow) => {
      savedRow = value;
      return Promise.resolve(value);
    });

    await expect(
      service.softDeleteBatchByUser(42, [7], 'shipping-agency'),
    ).resolves.toEqual({ deletedCount: 1 });

    expect(shippingRepo.find).toHaveBeenCalledTimes(1);
    expect(charteringRepo.find).not.toHaveBeenCalled();
    expect(shippingRepo.save).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(savedRow).toMatchObject({ id: 7, userId: 42, deletedById: 42 });
    expect(savedRow?.deletedAt).toBeInstanceOf(Date);
  });

  it('does not delete a record owned by another user', async () => {
    shippingRepo.find.mockResolvedValue([
      { id: 7, userId: 99, deletedAt: null, deletedById: null },
    ]);

    await expect(
      service.softDeleteBatchByUser(42, [7], 'shipping-agency'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(shippingRepo.save).not.toHaveBeenCalled();
    expect(charteringRepo.find).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('propagates a batch write failure through one transaction boundary', async () => {
    shippingRepo.find.mockResolvedValue([
      { id: 7, userId: 42, deletedAt: null, deletedById: null },
      { id: 8, userId: 42, deletedAt: null, deletedById: null },
    ]);
    shippingRepo.save
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('second write failed'));

    await expect(
      service.softDeleteBatchByUser(42, [7, 8], 'shipping-agency'),
    ).rejects.toThrow('second write failed');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(shippingRepo.save).toHaveBeenCalledTimes(2);
    expect(transactionEvents).toEqual(['begin']);
  });

  it('commits document metadata and inquiry deletion before Cloudinary cleanup', async () => {
    shippingRepo.findOne.mockResolvedValue({
      id: 7,
      userId: 42,
      deletedAt: new Date(),
      serviceType: { name: 'SHIPPING AGENCY' },
    });
    shippingRepo.remove.mockImplementation(() => {
      transactionEvents.push('parent-delete');
      return Promise.resolve();
    });
    documentService.removeMetadataByInquiry.mockImplementation(() => {
      transactionEvents.push('metadata-delete');
      return Promise.resolve(['inquiries/shipping-agency/document-7']);
    });
    documentService.deleteStoredObjectsBestEffort.mockImplementation(() => {
      transactionEvents.push('external-cleanup');
      return Promise.resolve();
    });

    await service.hardDeleteByServiceAndId('shipping-agency', 7);

    expect(transactionEvents).toEqual([
      'begin',
      'metadata-delete',
      'parent-delete',
      'commit',
      'external-cleanup',
    ]);
    expect(documentService.deleteStoredObjectsBestEffort).toHaveBeenCalledWith([
      'inquiries/shipping-agency/document-7',
    ]);
  });
});
