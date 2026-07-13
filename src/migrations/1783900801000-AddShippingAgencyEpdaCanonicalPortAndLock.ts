import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class AddShippingAgencyEpdaCanonicalPortAndLock1783900801000 implements MigrationInterface {
  name = 'AddShippingAgencyEpdaCanonicalPortAndLock1783900801000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (
      !(await queryRunner.hasColumn('shipping_agency_inquiries', 'port_id'))
    ) {
      await queryRunner.addColumn(
        'shipping_agency_inquiries',
        new TableColumn({ name: 'port_id', type: 'integer', isNullable: true }),
      );
    }
    if (
      !(await queryRunner.hasColumn(
        'shipping_agency_inquiries',
        'epda_locked_at',
      ))
    ) {
      await queryRunner.addColumn(
        'shipping_agency_inquiries',
        new TableColumn({
          name: 'epda_locked_at',
          type: 'timestamp with time zone',
          isNullable: true,
        }),
      );
    }

    const table = await queryRunner.getTable('shipping_agency_inquiries');
    if (!table)
      throw new Error('shipping_agency_inquiries table does not exist');
    if (!table.foreignKeys.some((key) => key.columnNames.includes('port_id'))) {
      await queryRunner.createForeignKey(
        table,
        new TableForeignKey({
          name: 'fk_shipping_agency_inquiries_port',
          columnNames: ['port_id'],
          referencedTableName: 'ports',
          referencedColumnNames: ['id'],
          onDelete: 'SET NULL',
        }),
      );
    }
    if (
      !table.indices.some(
        (index) => index.name === 'idx_shipping_agency_inquiries_port_id',
      )
    ) {
      await queryRunner.createIndex(
        table,
        new TableIndex({
          name: 'idx_shipping_agency_inquiries_port_id',
          columnNames: ['port_id'],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('shipping_agency_inquiries');
    if (!table) return;

    const index = table.indices.find(
      (candidate) => candidate.name === 'idx_shipping_agency_inquiries_port_id',
    );
    if (index) await queryRunner.dropIndex(table, index);

    const foreignKey = table.foreignKeys.find(
      (candidate) => candidate.name === 'fk_shipping_agency_inquiries_port',
    );
    if (foreignKey) await queryRunner.dropForeignKey(table, foreignKey);

    if (await queryRunner.hasColumn(table, 'epda_locked_at')) {
      await queryRunner.dropColumn(table, 'epda_locked_at');
    }
    if (await queryRunner.hasColumn(table, 'port_id')) {
      await queryRunner.dropColumn(table, 'port_id');
    }
  }
}
