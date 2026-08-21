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
    name: 'document_number_v2',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  documentNumberV2!: string | null;
  @Column({ name: 'document_date', type: 'date', nullable: true })
  documentDate!: string | null;
  @Column({ name: 'shipper_party_id', type: 'int', nullable: true })
  shipperPartyId!: number | null;
  @Column({ name: 'consignee_party_id', type: 'int', nullable: true })
  consigneePartyId!: number | null;
  @Column({ name: 'notify_party_id', type: 'int', nullable: true })
  notifyPartyId!: number | null;
  @Column({ name: 'place_of_receipt_port_id', type: 'int', nullable: true })
  placeOfReceiptPortId!: number | null;
  @Column({ name: 'port_of_loading_id', type: 'int', nullable: true })
  portOfLoadingId!: number | null;
  @Column({ name: 'port_of_discharge_id', type: 'int', nullable: true })
  portOfDischargeId!: number | null;
  @Column({ name: 'place_of_delivery_port_id', type: 'int', nullable: true })
  placeOfDeliveryPortId!: number | null;
  @Column({ name: 'place_of_issue_port_id', type: 'int', nullable: true })
  placeOfIssuePortId!: number | null;
  @Column({
    name: 'ocean_vessel_text',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  oceanVesselText!: string | null;
  @Column({
    name: 'service_mode',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  serviceMode!: string | null;
  @Column({
    name: 'gross_weight_kg',
    type: 'numeric',
    precision: 18,
    scale: 3,
    nullable: true,
  })
  grossWeightKg!: string | null;
  @Column({ name: 'gross_weight_raw', type: 'text', nullable: true })
  grossWeightRaw!: string | null;
  @Column({
    name: 'measurement_cbm',
    type: 'numeric',
    precision: 18,
    scale: 3,
    nullable: true,
  })
  measurementCbm!: string | null;
  @Column({ name: 'measurement_raw', type: 'text', nullable: true })
  measurementRaw!: string | null;
  @Column({
    name: 'freight_terms',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  freightTerms!: string | null;
  @Column({ name: 'clean_on_board_date', type: 'date', nullable: true })
  cleanOnBoardDate!: string | null;
  @Column({
    name: 'freight_amount',
    type: 'numeric',
    precision: 18,
    scale: 3,
    nullable: true,
  })
  freightAmount!: string | null;
  @Column({ name: 'freight_amount_raw', type: 'text', nullable: true })
  freightAmountRaw!: string | null;
  @Column({
    name: 'freight_payable_at',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  freightPayableAt!: string | null;

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
