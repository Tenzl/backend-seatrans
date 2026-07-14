import { ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';
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

type RepositoryMock = {
  find: jest.Mock;
  save: jest.Mock;
};

type SavedDeleteRow = {
  id: number;
  userId: number;
  deletedById: number | null;
  deletedAt: Date | null;
};

const repositoryMock = (): RepositoryMock => ({
  find: jest.fn(),
  save: jest.fn(),
});

describe('ServiceInquiryService user batch delete', () => {
  let shippingRepo: RepositoryMock;
  let charteringRepo: RepositoryMock;
  let service: ServiceInquiryService;

  beforeEach(() => {
    shippingRepo = repositoryMock();
    charteringRepo = repositoryMock();

    service = new ServiceInquiryService(
      shippingRepo as unknown as Repository<ShippingAgencyInquiryEntity>,
      charteringRepo as unknown as Repository<CharteringBrokerageInquiryEntity>,
      repositoryMock() as unknown as Repository<FreightForwardingInquiryEntity>,
      repositoryMock() as unknown as Repository<TotalLogisticsInquiryEntity>,
      repositoryMock() as unknown as Repository<SpecialRequestInquiryEntity>,
      repositoryMock() as unknown as Repository<InquiryFieldChangeLog>,
      repositoryMock() as unknown as Repository<ServiceType>,
      repositoryMock() as unknown as Repository<User>,
      {} as InquiryDocumentService,
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
  });
});
