import { ServiceUnavailableException } from '@nestjs/common';
import type { EntityManager, Repository } from 'typeorm';
import { ServiceInquiryService } from './service-inquiry.service';
import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';
import { CharteringBrokerageInquiryEntity } from '../entities/chartering-brokerage-inquiry.entity';
import { FreightForwardingInquiryEntity } from '../entities/freight-forwarding-inquiry.entity';
import { TotalLogisticsInquiryEntity } from '../entities/total-logistics-inquiry.entity';
import { SpecialRequestInquiryEntity } from '../entities/special-request-inquiry.entity';
import { ServiceType } from '../../logistics/entities/service-type.entity';
import { User } from '../../auth/entities/user.entity';
import { InquiryDocumentService } from './inquiry-document.service';
import { NotificationService } from '../../notification/notification.service';
import { InquiryRepositoryRegistry } from './inquiry-repository.registry';
import { InquiryQueryService } from './inquiry-query.service';
import { InquiryIdempotencyService } from './inquiry-idempotency.service';
import { InquiryCodeAllocator } from './inquiry-code-allocator';
import { InquirySubmissionLifecycle } from './inquiry-submission-lifecycle';

type SubmissionHarness = {
  service: ServiceInquiryService;
  events: string[];
  inquiryRepository: {
    manager: { transaction: jest.Mock };
    delete: jest.Mock;
  };
  transactionalRepository: {
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  transactionManager: {
    query: jest.Mock;
    getRepository: jest.Mock;
  };
  documentService: {
    saveAttachmentsForInquiry: jest.Mock;
  };
  notificationService: {
    notifyInternalNewInquiry: jest.Mock;
  };
  idempotencyService: {
    hashSubmitRequest: jest.Mock;
    beginSubmit: jest.Mock;
    completeSubmit: jest.Mock;
    abandonSubmit: jest.Mock;
  };
};

const unusedRepository = <T>(): Repository<T> =>
  ({}) as unknown as Repository<T>;

function setupSubmission(): SubmissionHarness {
  const events: string[] = [];
  const serviceType = {
    id: 1,
    name: 'SHIPPING AGENCY',
  } as ServiceType;
  const currentUser = {
    id: 42,
    fullName: 'Customer',
    email: 'customer@example.com',
  } as User;

  const queryBuilder = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockImplementation(() => {
      events.push('code:read-last');
      return Promise.resolve({ lastNumber: '7' });
    }),
  };
  const transactionalRepository = {
    create: jest.fn((value: object) => value),
    save: jest.fn().mockImplementation((value: object) => {
      events.push('inquiry:save');
      return Promise.resolve({ id: 8, ...value });
    }),
    createQueryBuilder: jest.fn(() => queryBuilder),
  };
  const transactionManager = {
    query: jest.fn().mockImplementation(() => {
      events.push('code:lock');
      return Promise.resolve([]);
    }),
    getRepository: jest.fn(() => transactionalRepository),
  };
  const inquiryRepository = {
    target: ShippingAgencyInquiryEntity,
    manager: {
      transaction: jest
        .fn()
        .mockImplementation(
          async (work: (manager: EntityManager) => Promise<unknown>) => {
            events.push('transaction:start');
            const result = await work(
              transactionManager as unknown as EntityManager,
            );
            events.push('transaction:commit');
            return result;
          },
        ),
    },
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const userRepository = {
    findOne: jest.fn().mockResolvedValue(currentUser),
  };
  const serviceTypeRepository = {
    findOne: jest.fn().mockResolvedValue(serviceType),
  };
  const documentService = {
    saveAttachmentsForInquiry: jest.fn().mockImplementation(() => {
      events.push('attachments:save');
      return Promise.resolve();
    }),
  };
  const notificationService = {
    notifyInternalNewInquiry: jest.fn().mockImplementation(() => {
      events.push('notification:send');
      return Promise.resolve();
    }),
  };
  const idempotencyService = {
    hashSubmitRequest: jest.fn().mockReturnValue('hash-abc'),
    beginSubmit: jest.fn().mockResolvedValue(null),
    completeSubmit: jest.fn().mockResolvedValue(undefined),
    abandonSubmit: jest.fn().mockResolvedValue(undefined),
  };

  const repositories = new InquiryRepositoryRegistry(
    inquiryRepository as unknown as Repository<ShippingAgencyInquiryEntity>,
    unusedRepository<CharteringBrokerageInquiryEntity>(),
    unusedRepository<FreightForwardingInquiryEntity>(),
    unusedRepository<TotalLogisticsInquiryEntity>(),
    unusedRepository<SpecialRequestInquiryEntity>(),
  );
  const submissionLifecycle = new InquirySubmissionLifecycle(
    repositories,
    new InquiryCodeAllocator(),
  );
  const service = new ServiceInquiryService(
    repositories,
    new InquiryQueryService(repositories),
    serviceTypeRepository as unknown as Repository<ServiceType>,
    userRepository as unknown as Repository<User>,
    documentService as unknown as InquiryDocumentService,
    notificationService as unknown as NotificationService,
    idempotencyService as unknown as InquiryIdempotencyService,
    submissionLifecycle,
  );

  return {
    service,
    events,
    inquiryRepository,
    transactionalRepository,
    transactionManager,
    documentService,
    notificationService,
    idempotencyService,
  };
}

describe('ServiceInquiryService submission consistency', () => {
  const submission = {
    serviceTypeId: 1,
    vesselName: 'MV Safe',
  };

  it('allocates the inquiry code and inserts the inquiry under one advisory-locked transaction', async () => {
    const harness = setupSubmission();

    await harness.service.submitInquiry(submission, [], 42);

    expect(harness.inquiryRepository.manager.transaction).toHaveBeenCalledTimes(
      1,
    );
    expect(harness.transactionManager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [expect.stringMatching(/^inquiry-code:SA-\d{4}-$/)],
    );
    expect(harness.transactionManager.getRepository).toHaveBeenCalledWith(
      ShippingAgencyInquiryEntity,
    );
    const expectedCode = `SA-${new Date().getFullYear()}-0008`;
    expect(harness.transactionalRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ code: expectedCode }),
    );
    expect(harness.events.indexOf('code:lock')).toBeLessThan(
      harness.events.indexOf('code:read-last'),
    );
    expect(harness.events.indexOf('transaction:commit')).toBeLessThan(
      harness.events.indexOf('notification:send'),
    );
  });

  it('keeps a committed inquiry successful when its post-commit notification fails', async () => {
    const harness = setupSubmission();
    harness.notificationService.notifyInternalNewInquiry.mockRejectedValueOnce(
      new Error('notification database unavailable'),
    );

    await expect(
      harness.service.submitInquiry(submission, [], 42),
    ).resolves.toMatchObject({ targetId: 8 });

    expect(harness.transactionalRepository.save).toHaveBeenCalledTimes(1);
    expect(harness.inquiryRepository.delete).not.toHaveBeenCalled();
  });

  it('does not report success and compensates the inquiry when requested attachments fail', async () => {
    const harness = setupSubmission();
    harness.documentService.saveAttachmentsForInquiry.mockRejectedValueOnce(
      new Error('object storage unavailable'),
    );
    const file = {
      originalname: 'cargo.pdf',
      buffer: Buffer.from('pdf'),
    } as Express.Multer.File;

    await expect(
      harness.service.submitInquiry(submission, [file], 42),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(harness.inquiryRepository.delete).toHaveBeenCalledWith(8);
    expect(
      harness.notificationService.notifyInternalNewInquiry,
    ).not.toHaveBeenCalled();
  });

  it('returns the stored result for a repeated Idempotency-Key without creating again', async () => {
    const harness = setupSubmission();
    const prior = {
      message: 'Inquiry submitted successfully.',
      serviceSlug: 'shipping-agency',
      targetId: 99,
    };
    harness.idempotencyService.beginSubmit.mockResolvedValueOnce(prior);

    await expect(
      harness.service.submitInquiry(submission, [], 42, 'key-1'),
    ).resolves.toEqual(prior);

    expect(harness.idempotencyService.hashSubmitRequest).toHaveBeenCalled();
    expect(harness.transactionalRepository.save).not.toHaveBeenCalled();
    expect(harness.idempotencyService.completeSubmit).not.toHaveBeenCalled();
  });

  it('completes the idempotency record after a successful submit', async () => {
    const harness = setupSubmission();

    await harness.service.submitInquiry(submission, [], 42, 'key-2');

    expect(harness.idempotencyService.beginSubmit).toHaveBeenCalledWith(
      42,
      'key-2',
      'hash-abc',
    );
    expect(harness.idempotencyService.completeSubmit).toHaveBeenCalledWith(
      42,
      'key-2',
      expect.objectContaining({ targetId: 8, serviceSlug: 'shipping-agency' }),
    );
  });

  it('abandons the idempotency claim when submit fails', async () => {
    const harness = setupSubmission();
    harness.documentService.saveAttachmentsForInquiry.mockRejectedValueOnce(
      new Error('object storage unavailable'),
    );
    const file = {
      originalname: 'cargo.pdf',
      size: 3,
    } as Express.Multer.File;

    await expect(
      harness.service.submitInquiry(submission, [file], 42, 'key-3'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(harness.idempotencyService.abandonSubmit).toHaveBeenCalledWith(
      42,
      'key-3',
    );
    expect(harness.idempotencyService.completeSubmit).not.toHaveBeenCalled();
  });
});
