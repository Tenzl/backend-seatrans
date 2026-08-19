import { TypeOrmCommodityUsageChecker } from './typeorm-commodity-usage.checker';

describe('TypeOrmCommodityUsageChecker independent catalog snapshots', () => {
  const bookingTables = [
    'booking_records',
    'arrival_notice_records',
    'delivery_order_records',
    'bill_of_lading_records',
  ];

  function subject() {
    const emptyRepository = {
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      })),
    };
    const dataSource = { query: jest.fn().mockResolvedValue([]) };
    return {
      checker: new TypeOrmCommodityUsageChecker(
        emptyRepository as never,
        emptyRepository as never,
        emptyRepository as never,
        emptyRepository as never,
        dataSource as never,
      ),
      dataSource,
    };
  }

  it('checks IDs, names and generated "Commodity IN Type" snapshots', async () => {
    const { checker, dataSource } = subject();

    await expect(
      checker.isInUse({ id: 22, name: 'RICE', displayName: 'Rice' }),
    ).resolves.toBe(false);

    expect(dataSource.query).toHaveBeenCalledTimes(4);
    const sql = dataSource.query.mock.calls
      .map(([query]) => String(query))
      .join('\n');
    for (const table of bookingTables) expect(sql).toContain(`FROM ${table}`);
    expect(sql).toContain("payload->>'commodityId'");
    expect(sql).toContain("payload->>'commodityName'");
    expect(sql).toContain("name || ' in %'");
  });

  it('checks commodityTypeId and BL container Package Type snapshots in every document table', async () => {
    const { checker, dataSource } = subject();

    await expect(checker.isTypeInUse({ id: 11, name: 'Bulk' })).resolves.toBe(
      false,
    );

    expect(dataSource.query).toHaveBeenCalledTimes(4);
    const sql = dataSource.query.mock.calls
      .map(([query]) => String(query))
      .join('\n');
    for (const table of bookingTables) expect(sql).toContain(`FROM ${table}`);
    expect(sql).toContain("payload->>'commodityTypeId'");
    expect(sql).toContain("container->>'packageType'");
    expect(sql).toContain('jsonb_array_elements');
    expect(sql).not.toContain("payload->>'commodityId'");
  });
});
