import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BookingDocumentType } from '../enums/booking-document-type.enum';
import { BookingDocumentRecordBase } from './booking-document-record-base.entity';
import { BookingRecord } from './booking-record.entity';

@Entity('arrival_notice_records')
@Index('idx_arrival_notice_records_active_created_at', ['createdAt', 'id'], {
  where: '"deleted_at" IS NULL',
})
@Index(
  'idx_arrival_notice_records_booking_id',
  ['bookingId', 'createdAt', 'id'],
  { where: '"booking_id" IS NOT NULL AND "deleted_at" IS NULL' },
)
@Index('uq_arrival_notice_records_active_booking', ['bookingId'], {
  unique: true,
  where: '"booking_id" IS NOT NULL AND "deleted_at" IS NULL',
})
@Index('idx_arrival_notice_records_an_number', ['anNumber'], {
  where: '"deleted_at" IS NULL',
})
@Index('idx_arrival_notice_records_mbl_number', ['mblNumber'], {
  where: '"deleted_at" IS NULL',
})
@Index('idx_arrival_notice_records_hbl_number', ['hblNumber'], {
  where: '"deleted_at" IS NULL',
})
@Index('idx_arrival_notice_records_shipment_number', ['shipmentNumber'], {
  where: '"deleted_at" IS NULL',
})
@Index('idx_arrival_notice_records_reference_number', ['referenceNumber'], {
  where: '"deleted_at" IS NULL',
})
@Index('idx_arrival_notice_records_vessel_voyage', ['vesselVoyage'], {
  where: '"deleted_at" IS NULL',
})
export class ArrivalNoticeRecord extends BookingDocumentRecordBase {
  readonly documentType = BookingDocumentType.ARRIVAL_NOTICE;

  @Column({ name: 'booking_id', type: 'bigint', nullable: true })
  bookingId!: number | null;

  @ManyToOne(() => BookingRecord, (booking) => booking.arrivalNotices, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'booking_id' })
  booking?: BookingRecord | null;

  @Column({
    name: 'an_number',
    type: 'varchar',
    length: 100,
    nullable: true,
    asExpression: "(payload ->> 'anNumber')",
    generatedType: 'STORED',
    insert: false,
    update: false,
  })
  readonly anNumber!: string | null;

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
    name: 'reference_number',
    type: 'varchar',
    length: 200,
    nullable: true,
    asExpression: "(payload ->> 'referenceNumber')",
    generatedType: 'STORED',
    insert: false,
    update: false,
  })
  readonly referenceNumber!: string | null;

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
