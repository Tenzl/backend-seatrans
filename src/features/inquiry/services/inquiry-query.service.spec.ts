import { InquiryQueryService } from './inquiry-query.service';
import { InquiryRepositoryRegistry } from './inquiry-repository.registry';
import type { Repository } from 'typeorm';
import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';
import { CharteringBrokerageInquiryEntity } from '../entities/chartering-brokerage-inquiry.entity';
import { FreightForwardingInquiryEntity } from '../entities/freight-forwarding-inquiry.entity';
import { TotalLogisticsInquiryEntity } from '../entities/total-logistics-inquiry.entity';
import { SpecialRequestInquiryEntity } from '../entities/special-request-inquiry.entity';
import { InquiryStatus } from '../enums/inquiry-status.enum';
import { InquiryCreatedSource } from '../enums/inquiry-created-source.enum';

describe('InquiryQueryService list filters (FE-03)', () => {
  function setup() {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(2),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: 'SA-2026-0001',
          fullName: 'Ada',
          email: 'ada@example.com',
          phone: null,
          company: 'Sea Co',
          notes: null,
          status: InquiryStatus.PROCESSING,
          serviceType: { id: 1, name: 'SHIPPING AGENCY', displayName: 'SA' },
          userId: 9,
          user: {
            id: 9,
            fullName: 'Ada',
            email: 'ada@example.com',
          },
          processedBy: {
            id: 99,
            fullName: 'Employee',
            email: 'employee@example.com',
          },
          createdSource: InquiryCreatedSource.CUSTOMER_PORTAL,
          submittedAt: new Date('2026-08-01T10:00:00.000Z'),
          updatedAt: new Date('2026-08-01T10:00:00.000Z'),
          deletedAt: null,
          mv: 'MV Test',
        },
      ]),
    };

    const shippingRepo = {
      metadata: { tableName: 'shipping_agency_inquiries' },
      createQueryBuilder: jest.fn(() => qb),
      find: jest.fn(),
      findOne: jest.fn(),
      manager: { query: jest.fn() },
    };

    const unused = {
      createQueryBuilder: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      manager: shippingRepo.manager,
    };

    const repositories = new InquiryRepositoryRegistry(
      shippingRepo as unknown as Repository<ShippingAgencyInquiryEntity>,
      unused as unknown as Repository<CharteringBrokerageInquiryEntity>,
      unused as unknown as Repository<FreightForwardingInquiryEntity>,
      unused as unknown as Repository<TotalLogisticsInquiryEntity>,
      unused as unknown as Repository<SpecialRequestInquiryEntity>,
    );

    const service = new InquiryQueryService(repositories);
    return { service, qb, shippingRepo };
  }

  it('applies q + dateFrom/dateTo in SQL and returns filtered totals', async () => {
    const { service, qb } = setup();

    const page = await service.list(
      {
        serviceType: {
          id: 1,
          name: 'SHIPPING AGENCY',
        } as never,
        archivedFilter: 'active',
      },
      {
        page: 0,
        size: 20,
        q: '100%_Ada',
        dateFrom: '2026-08-01T00:00:00.000Z',
        dateTo: '2026-08-07T23:59:59.999Z',
      },
    );

    expect(qb.andWhere).toHaveBeenCalledWith('inquiry.deleted_at IS NULL');
    expect(qb.andWhere).toHaveBeenCalledWith(
      'inquiry.submitted_at >= :dateFrom',
      { dateFrom: new Date('2026-08-01T00:00:00.000Z') },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      'inquiry.submitted_at <= :dateTo',
      { dateTo: new Date('2026-08-07T23:59:59.999Z') },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("LIKE :q ESCAPE E'\\\\'"),
      { q: '%100\\%\\_ada%' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('.mv'), {
      q: '%100\\%\\_ada%',
    });
    expect(page.totalElements).toBe(2);
    expect(page.content).toHaveLength(1);
    expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
      'inquiry.processedBy',
      'employeeInCharge',
    );
    expect(page.content[0]).toMatchObject({
      employeeInCharge: { id: 99 },
      clientSubmittedBy: { id: 9 },
    });
  });

  it('pushes q/date filters into the cross-service UNION count/page SQL', async () => {
    const { service, shippingRepo } = setup();
    const managerQuery = shippingRepo.manager.query;
    managerQuery.mockResolvedValueOnce([{ total: 3 }]).mockResolvedValueOnce([
      {
        id: 11,
        slug: 'shipping-agency',
        submitted_at: '2026-08-02T00:00:00.000Z',
      },
    ]);
    shippingRepo.find = jest.fn().mockResolvedValue([
      {
        id: 11,
        code: 'SA-1',
        fullName: 'Bob',
        email: 'b@example.com',
        phone: null,
        company: null,
        notes: null,
        status: InquiryStatus.PROCESSING,
        serviceType: { id: 1, name: 'SHIPPING AGENCY', displayName: 'SA' },
        userId: 1,
        submittedAt: new Date('2026-08-02T00:00:00.000Z'),
        updatedAt: new Date('2026-08-02T00:00:00.000Z'),
        deletedAt: null,
        mv: null,
      },
    ]);

    const page = await service.list(
      { archivedFilter: 'active' },
      {
        page: 0,
        size: 20,
        q: 'Bob',
        dateFrom: '2026-08-01T00:00:00.000Z',
      },
    );

    expect(managerQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/full_name[\s\S]*submitted_at >=/),
      expect.arrayContaining([new Date('2026-08-01T00:00:00.000Z'), '%bob%']),
    );
    expect(page.totalElements).toBe(3);
    expect(page.content).toHaveLength(1);
  });
});
