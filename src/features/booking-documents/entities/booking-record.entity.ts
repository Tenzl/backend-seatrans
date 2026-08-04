import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BookingDocumentType } from '../enums/booking-document-type.enum';
import { BookingFlow } from '../enums/booking-flow.enum';
import { ArrivalNoticeRecord } from './arrival-notice-record.entity';
import { BillOfLadingRecord } from './bill-of-lading-record.entity';
import { BookingDocumentRecordBase } from './booking-document-record-base.entity';
import { DeliveryOrderRecord } from './delivery-order-record.entity';

@Entity('booking_records')
@Index('idx_booking_records_active_created_at', ['createdAt', 'id'], {
  where: '"deleted_at" IS NULL',
})
@Index('idx_booking_records_booking_number', ['bookingNumber'], {
  where: '"deleted_at" IS NULL',
})
@Index('idx_booking_records_vessel_voyage', ['vesselVoyage'], {
  where: '"deleted_at" IS NULL',
})
export class BookingRecord extends BookingDocumentRecordBase {
  readonly documentType = BookingDocumentType.BOOKING_CONFIRMATION;

  @Column({ name: 'booking_flow', type: 'varchar', length: 10 })
  bookingFlow!: BookingFlow;

  @Column({
    name: 'booking_number',
    type: 'varchar',
    length: 200,
    nullable: true,
    asExpression: "(payload ->> 'bookingNumber')",
    generatedType: 'STORED',
    insert: false,
    update: false,
  })
  readonly bookingNumber!: string | null;

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

  @OneToMany(() => ArrivalNoticeRecord, (record) => record.booking)
  arrivalNotices?: ArrivalNoticeRecord[];

  @OneToMany(() => DeliveryOrderRecord, (record) => record.booking)
  deliveryOrders?: DeliveryOrderRecord[];

  @OneToMany(() => BillOfLadingRecord, (record) => record.booking)
  billsOfLading?: BillOfLadingRecord[];
}
