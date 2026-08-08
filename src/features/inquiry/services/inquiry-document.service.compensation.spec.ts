import type { Repository } from 'typeorm';
import { InquiryDocumentService } from './inquiry-document.service';
import { InquiryDocument } from '../entities/inquiry-document.entity';
import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';
import { CharteringBrokerageInquiryEntity } from '../entities/chartering-brokerage-inquiry.entity';
import { FreightForwardingInquiryEntity } from '../entities/freight-forwarding-inquiry.entity';
import { TotalLogisticsInquiryEntity } from '../entities/total-logistics-inquiry.entity';
import { SpecialRequestInquiryEntity } from '../entities/special-request-inquiry.entity';
import { User } from '../../auth/entities/user.entity';
import { CloudinaryService } from '../../../shared/services/cloudinary.service';

const repository = <T>(value: object = {}): Repository<T> =>
  value as Repository<T>;

function file(name: string): Express.Multer.File {
  return {
    originalname: name,
    buffer: Buffer.from(`%PDF-1.7\n${name}`),
    size: name.length + 8,
    mimetype: 'application/pdf',
  } as Express.Multer.File;
}

describe('InquiryDocumentService attachment compensation', () => {
  it('deletes an uploaded object when persisting its document row fails', async () => {
    const documentRepository = {
      create: jest.fn((value: object) => value),
      save: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const inquiryRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 8,
        serviceType: { name: 'SHIPPING AGENCY' },
      }),
    };
    const userRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 42 }),
    };
    const cloudinaryService = {
      uploadRaw: jest.fn().mockResolvedValue({
        publicId: 'inquiries/shipping-agency/file-1',
        secureUrl: 'https://example.test/file-1',
      }),
      deleteByPublicId: jest.fn().mockResolvedValue(undefined),
    };
    const service = new InquiryDocumentService(
      repository<InquiryDocument>(documentRepository),
      repository<ShippingAgencyInquiryEntity>(inquiryRepository),
      repository<CharteringBrokerageInquiryEntity>(),
      repository<FreightForwardingInquiryEntity>(),
      repository<TotalLogisticsInquiryEntity>(),
      repository<SpecialRequestInquiryEntity>(),
      repository<User>(userRepository),
      cloudinaryService as unknown as CloudinaryService,
    );

    await expect(
      service.uploadDocument(
        'shipping-agency',
        8,
        'OTHER',
        file('cargo.pdf'),
        undefined,
        42,
      ),
    ).rejects.toThrow('database unavailable');

    expect(cloudinaryService.deleteByPublicId).toHaveBeenCalledWith(
      'inquiries/shipping-agency/file-1',
      'raw',
    );
  });

  it('removes earlier attachments when a later attachment in the batch fails', async () => {
    type CompensationDouble = InquiryDocumentService & {
      userRepository: { findOne: jest.Mock };
      uploadResolved: jest.Mock;
    };
    const service = Object.create(
      InquiryDocumentService.prototype,
    ) as CompensationDouble;
    // PERF-02: saveAttachmentsForInquiry calls requireUploader, then uploadResolved.
    service.userRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 42 }),
    };
    const firstDocument = { id: 11 };
    service.uploadResolved = jest
      .fn()
      .mockResolvedValueOnce(firstDocument)
      .mockRejectedValueOnce(new Error('second upload failed'));
    const deleteDocument = jest.fn().mockResolvedValue(undefined);
    service.deleteDocument = deleteDocument;
    const inquiry = {
      id: 8,
      serviceType: { name: 'SHIPPING AGENCY' },
    } as ShippingAgencyInquiryEntity;

    await expect(
      service.saveAttachmentsForInquiry(
        inquiry,
        [file('first.pdf'), file('second.pdf')],
        42,
      ),
    ).rejects.toThrow('second upload failed');

    expect(deleteDocument).toHaveBeenCalledWith(11);
  });
});
