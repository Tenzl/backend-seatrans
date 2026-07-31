import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';
import {
  diffEpdaFieldSnapshots,
  epdaFieldSnapshot,
} from './shipping-agency-epda-audit';

describe('shipping agency EPDA audit mapping', () => {
  it('normalizes equivalent PostgreSQL numeric strings before diffing', () => {
    const before = epdaFieldSnapshot({
      grt: '12000.00',
      garbageUsdRate: '54.0000',
    } as ShippingAgencyInquiryEntity);
    const after = epdaFieldSnapshot({
      grt: '12000',
      garbageUsdRate: '54',
    } as ShippingAgencyInquiryEntity);

    expect(diffEpdaFieldSnapshots(before, after)).toEqual([]);
  });

  it('returns only fields whose normalized value changed', () => {
    const before = epdaFieldSnapshot({
      mv: 'MV OLD',
      grt: '12000.00',
    } as ShippingAgencyInquiryEntity);
    const after = epdaFieldSnapshot({
      mv: 'MV NEW',
      grt: '12000',
    } as ShippingAgencyInquiryEntity);

    expect(diffEpdaFieldSnapshots(before, after)).toEqual([
      {
        field: 'Vessel',
        previousValue: 'MV OLD',
        newValue: 'MV NEW',
      },
    ]);
  });
});
