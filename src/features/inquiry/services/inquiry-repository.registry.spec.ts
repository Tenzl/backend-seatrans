import { BadRequestException } from '@nestjs/common';
import type { EntityManager, Repository } from 'typeorm';
import { InquiryRepositoryRegistry } from './inquiry-repository.registry';
import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';
import { CharteringBrokerageInquiryEntity } from '../entities/chartering-brokerage-inquiry.entity';
import { FreightForwardingInquiryEntity } from '../entities/freight-forwarding-inquiry.entity';
import { TotalLogisticsInquiryEntity } from '../entities/total-logistics-inquiry.entity';
import { SpecialRequestInquiryEntity } from '../entities/special-request-inquiry.entity';

const repository = <T>(): Repository<T> => ({}) as Repository<T>;

describe('InquiryRepositoryRegistry', () => {
  const shippingAgency = repository<ShippingAgencyInquiryEntity>();
  const chartering = repository<CharteringBrokerageInquiryEntity>();
  const freightForwarding = repository<FreightForwardingInquiryEntity>();
  const totalLogistics = repository<TotalLogisticsInquiryEntity>();
  const specialRequest = repository<SpecialRequestInquiryEntity>();
  const registry = new InquiryRepositoryRegistry(
    shippingAgency,
    chartering,
    freightForwarding,
    totalLogistics,
    specialRequest,
  );

  it.each([
    ['shipping agency', 'shipping-agency'],
    ['chartering-ship-broking', 'chartering'],
    ['freight forwarding', 'freight-forwarding'],
    ['total-logistics', 'total-logistic'],
    ['special request', 'special-request'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(registry.toSlug(input)).toBe(expected);
  });

  it('returns the repository registered for a normalized slug', () => {
    expect(registry.forSlug('shipping agency')).toBe(shippingAgency);
    expect(registry.forSlug('total-logistic')).toBe(totalLogistics);
  });

  it('uses the matching entity inside a transaction manager', () => {
    const transactionalRepository = repository<ShippingAgencyInquiryEntity>();
    const manager = {
      getRepository: jest.fn().mockReturnValue(transactionalRepository),
    };

    expect(
      registry.forSlug('shipping-agency', manager as unknown as EntityManager),
    ).toBe(transactionalRepository);
    expect(manager.getRepository).toHaveBeenCalledWith(
      ShippingAgencyInquiryEntity,
    );
  });

  it('keeps service-specific yearly code prefixes', () => {
    const year = new Date().getFullYear();

    expect(registry.codePrefix('shipping-agency')).toBe(`SA-${year}-`);
    expect(registry.codePrefix('total-logistics')).toBe(`TL-${year}-`);
  });

  it('rejects unsupported repositories', () => {
    expect(() => registry.forSlug('unknown-service')).toThrow(
      BadRequestException,
    );
  });
});
