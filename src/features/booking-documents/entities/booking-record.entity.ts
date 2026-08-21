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
    name: 'document_number_v2',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  documentNumberV2!: string | null;
  @Column({ name: 'document_date', type: 'date', nullable: true })
  documentDate!: string | null;
  @Column({ name: 'client_party_id', type: 'int', nullable: true })
  clientPartyId!: number | null;
  @Column({ name: 'place_of_receipt_port_id', type: 'int', nullable: true })
  placeOfReceiptPortId!: number | null;
  @Column({ name: 'port_of_loading_id', type: 'int', nullable: true })
  portOfLoadingId!: number | null;
  @Column({ name: 'place_of_issue_port_id', type: 'int', nullable: true })
  placeOfIssuePortId!: number | null;
  @Column({ name: 'pickup_port_id', type: 'int', nullable: true })
  pickupPortId!: number | null;
  @Column({ name: 'port_of_discharge_id', type: 'int', nullable: true })
  portOfDischargeId!: number | null;
  @Column({ name: 'place_of_delivery_port_id', type: 'int', nullable: true })
  placeOfDeliveryPortId!: number | null;
  @Column({ name: 'dropoff_port_id', type: 'int', nullable: true })
  dropoffPortId!: number | null;
  @Column({ name: 'transit_port_id', type: 'int', nullable: true })
  transitPortId!: number | null;
  @Column({
    name: 'vessel_voyage_text',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  vesselVoyageText!: string | null;
  @Column({ name: 'etd', type: 'date', nullable: true }) etd!: string | null;
  @Column({ name: 'eta', type: 'date', nullable: true }) eta!: string | null;
  @Column({ name: 'pickup_date', type: 'date', nullable: true })
  pickupDate!: string | null;
  @Column({ name: 'closing_time', type: 'timestamp', nullable: true })
  closingTime!: Date | null;
  @Column({ name: 'si_cutoff', type: 'timestamp', nullable: true })
  siCutoff!: Date | null;
  @Column({ name: 'vgm_cutoff', type: 'timestamp', nullable: true })
  vgmCutoff!: Date | null;
  @Column({ name: 'commodity_type_id', type: 'int', nullable: true })
  commodityTypeId!: number | null;
  @Column({ name: 'commodity_id', type: 'int', nullable: true }) commodityId!:
    number | null;
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
    name: 'mother_vessel',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  motherVessel!: string | null;
  @Column({
    name: 'mother_voyage',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  motherVoyage!: string | null;
  @Column({ name: 'pic_user_id', type: 'int', nullable: true }) picUserId!:
    number | null;

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
