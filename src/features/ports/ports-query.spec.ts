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
      expect.stringContaining('COUNT(*)::int'),
      [true, 3, 2, '%da%'],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('SELECT port.id'),
      [true, 3, 2, '%da%', 2, 2],
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

function createPort(id: number, name: string): Port {
  return {
    id,
    name,
    portOfCall: name.toUpperCase(),
    province: null,
    zoneCode: null,
    countryCode: 'VN',
    code: null,
    longitude: null,
    latitude: null,
    isActive: true,
    hasInfo: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };
}
