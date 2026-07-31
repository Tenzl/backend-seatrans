import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, EntityTarget, Repository } from 'typeorm';
import { BaseInquiry } from '../entities/base-inquiry.entity';
import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';
import { CharteringBrokerageInquiryEntity } from '../entities/chartering-brokerage-inquiry.entity';
import { FreightForwardingInquiryEntity } from '../entities/freight-forwarding-inquiry.entity';
import { TotalLogisticsInquiryEntity } from '../entities/total-logistics-inquiry.entity';
import { SpecialRequestInquiryEntity } from '../entities/special-request-inquiry.entity';

export type InquiryServiceSlug =
  | 'shipping-agency'
  | 'chartering'
  | 'freight-forwarding'
  | 'total-logistic'
  | 'special-request';

type InquirySource = {
  slug: InquiryServiceSlug;
  serviceName: string;
  tableName: string;
  entity: EntityTarget<BaseInquiry>;
  codePrefix: string;
};

const SOURCES: readonly InquirySource[] = [
  {
    slug: 'shipping-agency',
    serviceName: 'SHIPPING AGENCY',
    tableName: 'shipping_agency_inquiries',
    entity: ShippingAgencyInquiryEntity,
    codePrefix: 'SA',
  },
  {
    slug: 'chartering',
    serviceName: 'CHARTERING',
    tableName: 'chartering_broking_inquiries',
    entity: CharteringBrokerageInquiryEntity,
    codePrefix: 'CH',
  },
  {
    slug: 'freight-forwarding',
    serviceName: 'FREIGHT FORWARDING',
    tableName: 'freight_forwarding_inquiries',
    entity: FreightForwardingInquiryEntity,
    codePrefix: 'FF',
  },
  {
    slug: 'total-logistic',
    serviceName: 'LOGISTICS',
    tableName: 'total_logistics_inquiries',
    entity: TotalLogisticsInquiryEntity,
    codePrefix: 'TL',
  },
  {
    slug: 'special-request',
    serviceName: 'SPECIAL REQUEST',
    tableName: 'special_request_inquiries',
    entity: SpecialRequestInquiryEntity,
    codePrefix: 'SR',
  },
];

const SOURCE_BY_SLUG = new Map(SOURCES.map((source) => [source.slug, source]));

@Injectable()
export class InquiryRepositoryRegistry {
  private readonly repositories: Record<
    InquiryServiceSlug,
    Repository<BaseInquiry>
  >;

  constructor(
    @InjectRepository(ShippingAgencyInquiryEntity)
    shippingAgencyRepository: Repository<ShippingAgencyInquiryEntity>,
    @InjectRepository(CharteringBrokerageInquiryEntity)
    charteringRepository: Repository<CharteringBrokerageInquiryEntity>,
    @InjectRepository(FreightForwardingInquiryEntity)
    freightForwardingRepository: Repository<FreightForwardingInquiryEntity>,
    @InjectRepository(TotalLogisticsInquiryEntity)
    totalLogisticsRepository: Repository<TotalLogisticsInquiryEntity>,
    @InjectRepository(SpecialRequestInquiryEntity)
    specialRequestRepository: Repository<SpecialRequestInquiryEntity>,
  ) {
    this.repositories = {
      'shipping-agency': shippingAgencyRepository,
      chartering: charteringRepository,
      'freight-forwarding': freightForwardingRepository,
      'total-logistic': totalLogisticsRepository,
      'special-request': specialRequestRepository,
    };
  }

  get sources(): readonly InquirySource[] {
    return SOURCES;
  }

  get shippingAgency(): Repository<ShippingAgencyInquiryEntity> {
    return this.repositories[
      'shipping-agency'
    ] as Repository<ShippingAgencyInquiryEntity>;
  }

  forSlug(value: string, manager?: EntityManager): Repository<BaseInquiry> {
    const slug = this.toSlug(value);
    const source = SOURCE_BY_SLUG.get(slug as InquiryServiceSlug);
    if (!source) {
      throw new BadRequestException(`Unsupported service type: ${value}`);
    }
    return manager
      ? manager.getRepository(source.entity)
      : this.repositories[source.slug];
  }

  toServiceName(value: string): string {
    const normalized = value.trim().toLowerCase();
    const aliases: Record<string, InquiryServiceSlug> = {
      'shipping-agency': 'shipping-agency',
      'shipping agency': 'shipping-agency',
      chartering: 'chartering',
      'chartering-ship-broking': 'chartering',
      'chartering-broking': 'chartering',
      'freight-forwarding': 'freight-forwarding',
      'freight forwarding': 'freight-forwarding',
      logistics: 'total-logistic',
      'total-logistic': 'total-logistic',
      'total-logistics': 'total-logistic',
      'special-request': 'special-request',
      'special request': 'special-request',
    };
    const source = SOURCE_BY_SLUG.get(aliases[normalized]);
    return source?.serviceName ?? value.trim();
  }

  toSlug(value: string): string {
    const serviceName = this.toServiceName(value);
    const source = SOURCES.find(
      (candidate) => candidate.serviceName === serviceName,
    );
    return source?.slug ?? serviceName.toLowerCase().replace(/\s+/g, '-');
  }

  isShippingAgency(value: string): boolean {
    return this.toSlug(value) === 'shipping-agency';
  }

  codePrefix(value: string): string {
    const slug = this.toSlug(value);
    const source = SOURCE_BY_SLUG.get(slug as InquiryServiceSlug);
    const year = new Date().getFullYear();
    return `${source?.codePrefix ?? 'IN'}-${year}-`;
  }
}
