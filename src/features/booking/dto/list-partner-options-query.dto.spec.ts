import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListPartnerOptionsQueryDto } from './list-partner-options-query.dto';

describe('ListPartnerOptionsQueryDto', () => {
  it('accepts a ten-row Agent page filtered by customer type', async () => {
    const query = plainToInstance(ListPartnerOptionsQueryDto, {
      page: '2',
      limit: '10',
      q: 'international',
      customerType: 'AGENT',
    });

    await expect(validate(query)).resolves.toEqual([]);
    expect(query.page).toBe(2);
    expect(query.limit).toBe(10);
    expect(query.customerType).toBe('AGENT');
  });

  it('accepts an addition tag for non-Agent Party roles', async () => {
    const query = plainToInstance(ListPartnerOptionsQueryDto, {
      additionType: 'SHIPPER',
    });

    await expect(validate(query)).resolves.toEqual([]);
    expect(query.additionType).toBe('SHIPPER');
  });
});
