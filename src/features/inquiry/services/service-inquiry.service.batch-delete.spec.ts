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
import { InquiryIdempotencyService } from './inquiry-idempotency.service';
import { InquiryCodeAllocator } from './inquiry-code-allocator';
import { InquirySubmissionLifecycle } from './inquiry-submission-lifecycle';

type RepositoryMock = {
  find: jest.Mock;
  findOne: jest.Mock;
  remove: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
  manager?: {
    transaction: jest.Mock;
    query: jest.Mock;
  };
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
  let managerQuery: jest.Mock;
  let transactionEvents: string[];
  let documentService: {
    removeMetadataByInquiry: jest.Mock;
    removeMetadataByInquiryIds: jest.Mock;
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
      removeMetadataByInquiryIds: jest.fn().mockResolvedValue([]),
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
    managerQuery = jest.fn();
    const manager = {
      getRepository: jest.fn((entity: EntityTarget<unknown>) => {
        const repository = repositoryByEntity.get(entity);
        if (!repository) throw new Error('Unexpected repository');
        return repository;
      }),
      query: managerQuery,
    } as unknown as EntityManager;
    transaction = jest.fn(
      async (work: (transactionManager: EntityManager) => Promise<unknown>) => {
        transactionEvents.push('begin');
        const result = await work(manager);
        transactionEvents.push('commit');
        return result;
      },
    );
    shippingRepo.manager = { transaction, query: managerQuery };

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
      {
        hashSubmitRequest: jest.fn(),
        beginSubmit: jest.fn(),
        completeSubmit: jest.fn(),
        abandonSubmit: jest.fn(),
      } as unknown as InquiryIdempotencyService,
      new InquirySubmissionLifecycle(repositories, new InquiryCodeAllocator()),
    );
  });

  it('soft-deletes with set-based UPDATE ANY for the requested service', async () => {
    managerQuery
      .mockResolvedValueOnce([{ id: 7 }]) // ownership check
      .mockResolvedValueOnce([{ id: 7 }]); // UPDATE RETURNING

    await expect(
      service.softDeleteBatchByUser(42, [7], 'shipping-agency'),
    ).resolves.toEqual({ deletedCount: 1 });

    expect(managerQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('SELECT id FROM shipping_agency_inquiries'),
      [[7], 42],
    );
    expect(managerQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/UPDATE shipping_agency_inquiries[\s\S]*ANY\(\$1::bigint\[\]\)/),
      [[7], expect.any(Date), 42, 42],
    );
    expect(shippingRepo.save).not.toHaveBeenCalled();
    expect(charteringRepo.find).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('does not delete a record owned by another user', async () => {
    managerQuery.mockResolvedValueOnce([]); // ownership check fails

    await expect(
      service.softDeleteBatchByUser(42, [7], 'shipping-agency'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(shippingRepo.save).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('uses one set-based UPDATE per chunk instead of O(N) save()', async () => {
    const ids = Array.from({ length: 3 }, (_, i) => i + 1);
    managerQuery
      .mockResolvedValueOnce(ids.map((id) => ({ id })))
      .mockResolvedValueOnce(ids.map((id) => ({ id })));

    await expect(
      service.softDeleteBatchByUser(42, ids, 'shipping-agency'),
    ).resolves.toEqual({ deletedCount: 3 });

    expect(shippingRepo.save).not.toHaveBeenCalled();
    const updateCalls = managerQuery.mock.calls.filter((call) =>
      String(call[0]).includes('UPDATE shipping_agency_inquiries'),
    );
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][1][0]).toEqual(ids);
  });

  it('commits document metadata and inquiry deletion before Cloudinary cleanup', async () => {
    shippingRepo.findOne.mockResolvedValue({
      id: 7,
      userId: 42,
      deletedAt: new Date(),
      serviceType: { name: 'SHIPPING AGENCY' },
    });
    documentService.removeMetadataByInquiryIds.mockImplementation(() => {
      transactionEvents.push('metadata-delete');
      return Promise.resolve(['inquiries/shipping-agency/document-7']);
    });
    managerQuery.mockImplementation((sql: string) => {
      if (String(sql).includes('DELETE FROM shipping_agency_inquiries')) {
        transactionEvents.push('parent-delete');
        return Promise.resolve([{ id: 7 }]);
      }
      if (String(sql).includes('DELETE FROM notifications')) {
        transactionEvents.push('notification-delete');
        return Promise.resolve([]);
      }
      if (String(sql).includes('shipping_agency_field_change_logs')) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    documentService.deleteStoredObjectsBestEffort.mockImplementation(() => {
      transactionEvents.push('external-cleanup');
      return Promise.resolve();
    });

    await service.hardDeleteByServiceAndId('shipping-agency', 7);

    expect(transactionEvents).toEqual([
      'begin',
      'notification-delete',
      'metadata-delete',
      'parent-delete',
      'commit',
      'external-cleanup',
    ]);
    expect(managerQuery).toHaveBeenCalledWith(
      expect.stringMatching(
        /DELETE FROM notifications[\s\S]*inquiry_id = ANY\(\$1::bigint\[\]\)[\s\S]*serviceSlug[\s\S]*NOT EXISTS/,
      ),
      [['7'], 'shipping-agency'],
    );
    expect(documentService.deleteStoredObjectsBestEffort).toHaveBeenCalledWith([
      'inquiries/shipping-agency/document-7',
    ]);
    expect(shippingRepo.remove).not.toHaveBeenCalled();
  });

  it('hard-deletes a batch with set-based DELETE ANY and no per-row remove()', async () => {
    managerQuery
      .mockResolvedValueOnce([{ id: 7 }, { id: 8 }]) // groupIdsBySlug SELECT
      .mockResolvedValueOnce([]) // field change logs delete
      .mockResolvedValueOnce([]) // idempotency keys delete
      .mockResolvedValueOnce([]) // notifications delete
      .mockResolvedValueOnce([{ id: 7 }, { id: 8 }]); // inquiry DELETE RETURNING
    documentService.removeMetadataByInquiryIds.mockResolvedValue([
      'obj-7',
      'obj-8',
    ]);

    await expect(
      service.hardDeleteBatchByAdmin([7, 8], 'shipping-agency'),
    ).resolves.toEqual({ deletedCount: 2 });

    expect(documentService.removeMetadataByInquiryIds).toHaveBeenCalledWith(
      'shipping-agency',
      [7, 8],
      expect.anything(),
    );
    const notificationDeletes = managerQuery.mock.calls.filter((call) =>
      String(call[0]).includes('DELETE FROM notifications'),
    );
    expect(notificationDeletes).toHaveLength(1);
    expect(notificationDeletes[0][1]).toEqual([['7', '8'], 'shipping-agency']);
    expect(shippingRepo.remove).not.toHaveBeenCalled();
    expect(documentService.deleteStoredObjectsBestEffort).toHaveBeenCalledWith([
      'obj-7',
      'obj-8',
    ]);
  });
});
