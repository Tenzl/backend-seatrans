import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BookingDocumentType } from '../enums/booking-document-type.enum';
import { BookingDocumentRecordBase } from './booking-document-record-base.entity';
import { BookingRecord } from './booking-record.entity';

@Entity('delivery_order_records')
@Index('idx_delivery_order_records_active_created_at', ['createdAt', 'id'], {
  where: '"deleted_at" IS NULL',
})
@Index(
  'idx_delivery_order_records_booking_id',
  ['bookingId', 'createdAt', 'id'],
  { where: '"booking_id" IS NOT NULL AND "deleted_at" IS NULL' },
)
@Index('uq_delivery_order_records_active_booking', ['bookingId'], {
  unique: true,
  where: '"booking_id" IS NOT NULL AND "deleted_at" IS NULL',
})
@Index('idx_delivery_order_records_do_number', ['doNumber'], {
  where: '"deleted_at" IS NULL',
})
@Index('idx_delivery_order_records_mbl_number', ['mblNumber'], {
  where: '"deleted_at" IS NULL',
})
@Index('idx_delivery_order_records_hbl_number', ['hblNumber'], {
  where: '"deleted_at" IS NULL',
})
@Index('idx_delivery_order_records_shipment_number', ['shipmentNumber'], {
  where: '"deleted_at" IS NULL',
})
@Index('idx_delivery_order_records_vessel_voyage', ['vesselVoyage'], {
  where: '"deleted_at" IS NULL',
})
export class DeliveryOrderRecord extends BookingDocumentRecordBase {
  readonly documentType = BookingDocumentType.DELIVERY_ORDER;

  @Column({ name: 'booking_id', type: 'bigint', nullable: true })
  bookingId!: number | null;

  @ManyToOne(() => BookingRecord, (booking) => booking.deliveryOrders, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'booking_id' })
  booking?: BookingRecord | null;

  @Column({
    name: 'do_number',
    type: 'varchar',
    length: 100,
    nullable: true,
    asExpression: "(payload ->> 'doNumber')",
    generatedType: 'STORED',
    insert: false,
    update: false,
  })
  readonly doNumber!: string | null;

  @Column({
    name: 'mbl_number',
    type: 'varchar',
    length: 200,
    nullable: true,
    asExpression: "(payload ->> 'mblNumber')",
    generatedType: 'STORED',
    insert: false,
    update: false,
  })
  readonly mblNumber!: string | null;

  @Column({
    name: 'hbl_number',
    type: 'varchar',
    length: 200,
    nullable: true,
    asExpression: "(payload ->> 'hblNumber')",
    generatedType: 'STORED',
    insert: false,
    update: false,
  })
  readonly hblNumber!: string | null;

  @Column({
    name: 'shipment_number',
    type: 'varchar',
    length: 200,
    nullable: true,
    asExpression: "(payload ->> 'shipmentNumber')",
    generatedType: 'STORED',
    insert: false,
    update: false,
  })
  readonly shipmentNumber!: string | null;

  @Column({
    name: 'vessel_voyage',
    type: 'varchar',
    length: 300,
    nullable: true,
    asExpression: "(payload ->> 'vesselVoyage')",
    generatedType: 'STORED',
    insert: false,
    update: false,
  })
  readonly vesselVoyage!: string | null;
}
