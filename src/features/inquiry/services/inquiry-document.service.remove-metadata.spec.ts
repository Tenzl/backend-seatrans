import type { EntityManager, Repository } from 'typeorm';
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

describe('InquiryDocumentService.removeMetadataByInquiryIds', () => {
  it('scopes DELETE by service_slug so colliding target ids across services stay safe', async () => {
    const managerQuery = jest.fn().mockResolvedValue([
      { cloudinary_public_id: 'inquiries/shipping-agency/doc-12' },
    ]);
    const manager = { query: managerQuery } as unknown as EntityManager;
    const service = new InquiryDocumentService(
      repository<InquiryDocument>(),
      repository<ShippingAgencyInquiryEntity>(),
      repository<CharteringBrokerageInquiryEntity>(),
      repository<FreightForwardingInquiryEntity>(),
      repository<TotalLogisticsInquiryEntity>(),
      repository<SpecialRequestInquiryEntity>(),
      repository<User>(),
      {} as CloudinaryService,
    );

    // SA #12 and FF #12 can both exist; deleting SA must not touch FF rows.
    const publicIds = await service.removeMetadataByInquiryIds(
      'shipping-agency',
      [12],
      manager,
    );

    expect(publicIds).toEqual(['inquiries/shipping-agency/doc-12']);
    expect(managerQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = managerQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/DELETE FROM inquiry_documents/i);
    expect(sql).toMatch(/target_id = ANY\(\$1::bigint\[\]\)/i);
    expect(sql).toMatch(/service_slug = \$2/i);
    expect(params).toEqual([[12], 'shipping-agency']);
    expect(sql).not.toMatch(/WHERE target_id = ANY\(\$1::bigint\[\]\)\s*RETURNING/i);
  });

  it('normalizes service type display names to the stored slug before delete', async () => {
    const managerQuery = jest.fn().mockResolvedValue([]);
    const manager = { query: managerQuery } as unknown as EntityManager;
    const service = new InquiryDocumentService(
      repository<InquiryDocument>(),
      repository<ShippingAgencyInquiryEntity>(),
      repository<CharteringBrokerageInquiryEntity>(),
      repository<FreightForwardingInquiryEntity>(),
      repository<TotalLogisticsInquiryEntity>(),
      repository<SpecialRequestInquiryEntity>(),
      repository<User>(),
      {} as CloudinaryService,
    );

    await service.removeMetadataByInquiryIds('FREIGHT FORWARDING', [12], manager);

    expect(managerQuery.mock.calls[0][1]).toEqual([
      [12],
      'freight-forwarding',
    ]);
  });
});
