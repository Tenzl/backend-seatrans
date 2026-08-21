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
    name: 'document_number_v2',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  documentNumberV2!: string | null;
  @Column({ name: 'document_date', type: 'date', nullable: true })
  documentDate!: string | null;
  @Column({ name: 'agent_party_id', type: 'int', nullable: true })
  agentPartyId!: number | null;
  @Column({ name: 'shipper_party_id', type: 'int', nullable: true })
  shipperPartyId!: number | null;
  @Column({ name: 'consignee_party_id', type: 'int', nullable: true })
  consigneePartyId!: number | null;
  @Column({ name: 'notify_party_id', type: 'int', nullable: true })
  notifyPartyId!: number | null;
  @Column({
    name: 'master_bill_number_v2',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  masterBillNumberV2!: string | null;
  @Column({
    name: 'house_bill_number_v2',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  houseBillNumberV2!: string | null;
  @Column({
    name: 'shipment_number_v2',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  shipmentNumberV2!: string | null;
  @Column({
    name: 'reference_number_v2',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  referenceNumberV2!: string | null;
  @Column({ name: 'place_of_receipt_port_id', type: 'int', nullable: true })
  placeOfReceiptPortId!: number | null;
  @Column({ name: 'port_of_loading_id', type: 'int', nullable: true })
  portOfLoadingId!: number | null;
  @Column({ name: 'port_of_discharge_id', type: 'int', nullable: true })
  portOfDischargeId!: number | null;
  @Column({ name: 'place_of_delivery_port_id', type: 'int', nullable: true })
  placeOfDeliveryPortId!: number | null;
  @Column({ name: 'final_destination_port_id', type: 'int', nullable: true })
  finalDestinationPortId!: number | null;
  @Column({
    name: 'vessel_voyage_text',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  vesselVoyageText!: string | null;
  @Column({ name: 'etd', type: 'date', nullable: true }) etd!: string | null;
  @Column({ name: 'eta', type: 'date', nullable: true }) eta!: string | null;
  @Column({
    name: 'service_mode',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  serviceMode!: string | null;
  @Column({
    name: 'cfs_terminal',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  cfsTerminal!: string | null;
  @Column({ name: 'commodity_type_id', type: 'int', nullable: true })
  commodityTypeId!: number | null;
  @Column({ name: 'commodity_id', type: 'int', nullable: true })
  commodityId!: number | null;

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
