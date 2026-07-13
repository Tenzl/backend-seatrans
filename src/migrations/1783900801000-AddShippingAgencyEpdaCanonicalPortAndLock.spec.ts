import { AddShippingAgencyEpdaCanonicalPortAndLock1783900801000 } from './1783900801000-AddShippingAgencyEpdaCanonicalPortAndLock';

describe('AddShippingAgencyEpdaCanonicalPortAndLock1783900801000', () => {
  it('adds nullable canonical port/lock columns with port integrity metadata', async () => {
    const table = { foreignKeys: [], indices: [] };
    const queryRunner = {
      hasColumn: jest.fn().mockResolvedValue(false),
      addColumn: jest.fn(),
      getTable: jest.fn().mockResolvedValue(table),
      createForeignKey: jest.fn(),
      createIndex: jest.fn(),
    };

    await new AddShippingAgencyEpdaCanonicalPortAndLock1783900801000().up(
      queryRunner as never,
    );

    expect(queryRunner.addColumn).toHaveBeenNthCalledWith(
      1,
      'shipping_agency_inquiries',
      expect.objectContaining({ name: 'port_id', isNullable: true }),
    );
    expect(queryRunner.addColumn).toHaveBeenNthCalledWith(
      2,
      'shipping_agency_inquiries',
      expect.objectContaining({ name: 'epda_locked_at', isNullable: true }),
    );
    expect(queryRunner.createForeignKey).toHaveBeenCalledWith(
      table,
      expect.objectContaining({
        columnNames: ['port_id'],
        referencedTableName: 'ports',
        onDelete: 'SET NULL',
      }),
    );
    expect(queryRunner.createIndex).toHaveBeenCalledWith(
      table,
      expect.objectContaining({
        name: 'idx_shipping_agency_inquiries_port_id',
        columnNames: ['port_id'],
      }),
    );
  });
});
