import { PartnerAdditionType } from './partner-addition-type.enum';
import { CustomerType } from './customer-type.enum';

describe('PartnerAdditionType', () => {
  it('classifies Agent only as a customer type', () => {
    expect(Object.values(PartnerAdditionType)).not.toContain('AGENT');
    expect(CustomerType.AGENT).toBe('AGENT');
  });
});
