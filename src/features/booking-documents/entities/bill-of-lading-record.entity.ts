import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BookingDocumentType } from '../enums/booking-document-type.enum';
import { BookingDocumentRecordBase } from './booking-document-record-base.entity';
import { BookingRecord } from './booking-record.entity';

@Entity('bill_of_lading_records')
@Index('idx_bill_of_lading_records_active_created_at', ['createdAt', 'id'], {
  where: '"deleted_at" IS NULL',
})
@Index(
  'idx_bill_of_lading_records_booking_id',
  ['bookingId', 'createdAt', 'id'],
  { where: '"booking_id" IS NOT NULL AND "deleted_at" IS NULL' },
)
@Index('uq_bill_of_lading_records_active_booking', ['bookingId'], {
  unique: true,
  where: '"booking_id" IS NOT NULL AND "deleted_at" IS NULL',
})
@Index('idx_bill_of_lading_records_fbl_number', ['fblNumber'], {
  where: '"deleted_at" IS NULL',
})
@Index('idx_bill_of_lading_records_ocean_vessel', ['oceanVessel'], {
  where: '"deleted_at" IS NULL',
})
export class BillOfLadingRecord extends BookingDocumentRecordBase {
  readonly documentType = BookingDocumentType.BILL_OF_LADING;

  @Column({ name: 'booking_id', type: 'bigint', nullable: true })
  bookingId!: number | null;

  @ManyToOne(() => BookingRecord, (booking) => booking.billsOfLading, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'booking_id' })
  booking?: BookingRecord | null;

  @Column({
    name: 'fbl_number',
    type: 'varchar',
    length: 100,
    nullable: true,
    asExpression: "(payload ->> 'fblNumber')",
    generatedType: 'STORED',
    insert: false,
    update: false,
  })
  readonly fblNumber!: string | null;

  @Column({
    name: 'ocean_vessel',
    type: 'varchar',
    length: 300,
    nullable: true,
    asExpression: "(payload ->> 'oceanVessel')",
    generatedType: 'STORED',
    insert: false,
    update: false,
  })
  readonly oceanVessel!: string | null;
}
