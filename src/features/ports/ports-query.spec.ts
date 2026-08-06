import type { Repository } from 'typeorm';
import type { Port } from './entities/port.entity';
import { PortsQuery } from './ports-query';

describe('PortsQuery', () => {
  it('binds filters, paginates in SQL, and restores ranked id order', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ total: '2' }])
      .mockResolvedValueOnce([{ id: '2' }, { id: 1 }, { id: 'invalid' }]);
    const queryBuilder = createQueryBuilder([
      createPort(1, 'Alpha'),
      createPort(2, 'Beta'),
    ]);
    const portsQuery = new PortsQuery({
      query,
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<Port>);

    const page = await portsQuery.listPortsPage({
      page: 1,
      size: 2,
      active: true,
      provinceId: 3,
      area: 2,
      q: ' Da ',
      searchIn: 'name',
    });

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/COUNT\(\*\)::int[\s\S]*port\.code/),
      [true, 3, 2, '%da%', '%da%'],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('SELECT port.id'),
      [true, 3, 2, '%da%', '%da%', 2, 2],
    );
    expect(queryBuilder.where).toHaveBeenCalledWith('port.id IN (:...ids)', {
      ids: [2, 1],
    });
    expect(page).toMatchObject({
      content: [{ id: 2 }, { id: 1 }],
      page: 1,
      size: 2,
      totalElements: 2,
    });
  });

  it('matches port code when searchIn is name', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ total: '1' }])
      .mockResolvedValueOnce([{ id: 7 }]);
    const queryBuilder = createQueryBuilder([
      createPort(7, 'Qui Nhon', 'VNIUH'),
    ]);
    const portsQuery = new PortsQuery({
      query,
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<Port>);

    const page = await portsQuery.listPortsPage({
      q: 'vniuh',
      searchIn: 'name',
      active: true,
    });

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/port\.code/),
      [true, '%vniuh%', '%vniuh%'],
    );
    expect(page.content).toMatchObject([{ id: 7, code: 'VNIUH' }]);
  });

  it('uses a false condition for an invalid area search', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);
    const portsQuery = new PortsQuery({
      query,
    } as unknown as Repository<Port>);

    const page = await portsQuery.listPortsPage({
      q: 'middle',
      searchIn: 'area',
    });

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('1 = 0'),
      [],
    );
    expect(page.content).toEqual([]);
  });
});

function createQueryBuilder(ports: Port[]) {
  return {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(ports),
  };
}

function createPort(id: number, name: string, code: string | null = null): Port {
  return {
    id,
    name,
    portOfCall: name.toUpperCase(),
    province: null,
    zoneCode: null,
    countryCode: 'VN',
    code,
    longitude: null,
    latitude: null,
    isActive: true,
    hasInfo: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };
}
