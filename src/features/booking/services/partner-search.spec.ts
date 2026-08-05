import { buildPartnerContainsPattern } from './partner-search';

describe('Party contains search', () => {
  it('matches text that appears in the middle of a Party field', () => {
    expect(buildPartnerContainsPattern('  INTERNATIONAL  ')).toBe(
      '%international%',
    );
  });

  it('treats user-entered LIKE wildcard characters as literal text', () => {
    expect(buildPartnerContainsPattern('ACME_50%')).toBe('%acme\\_50\\%%');
  });
});
