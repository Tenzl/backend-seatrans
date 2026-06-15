import { Entity, Column, JoinColumn, ManyToOne } from 'typeorm';
import { BaseInquiry } from './base-inquiry.entity';
import { User } from '../../auth/entities/user.entity';

@Entity('shipping_agency_inquiries')
export class ShippingAgencyInquiryEntity extends BaseInquiry {
  // Customer-visible shipping agency fields
  @Column({ name: 'shipowner_to', type: 'varchar', length: 255, nullable: true })
  toName!: string | null;

  @Column({ name: 'mv', type: 'varchar', length: 255, nullable: true })
  mv!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  grt!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  dwt!: string | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  loa!: string | null;

  @Column({ type: 'date', nullable: true })
  eta!: string | null;

  @Column({ name: 'cargo_type', type: 'varchar', length: 255, nullable: true })
  cargoType!: string | null;

  @Column({ name: 'cargo_name', type: 'varchar', length: 255, nullable: true })
  cargoName!: string | null;

  @Column({ name: 'cargo_name_other', type: 'varchar', length: 255, nullable: true })
  cargoNameOther!: string | null;

  @Column({ name: 'cargo_quantity', type: 'varchar', length: 255, nullable: true })
  cargoQuantity!: string | null;

  @Column({ name: 'frt_tax_type', type: 'varchar', length: 64, nullable: true })
  frtTaxType!: string | null;

  @Column({ name: 'purpose_of_calling', type: 'varchar', length: 64, nullable: true })
  purposeOfCalling!: string | null;

  @Column({ name: 'port_of_call', type: 'varchar', length: 255, nullable: true })
  portOfCall!: string | null;

  @Column({ name: 'discharge_loading_location', type: 'varchar', length: 64, nullable: true })
  dischargeLoadingLocation!: string | null;

  @Column({ name: 'boat_hire_amount', type: 'decimal', precision: 15, scale: 2, nullable: true })
  boatHireAmount!: string | null;

  @Column({ name: 'tally_fee_amount', type: 'decimal', precision: 15, scale: 2, nullable: true })
  tallyFeeAmount!: string | null;

  @Column({ name: 'tug_assistance_amount', type: 'decimal', precision: 15, scale: 2, nullable: true })
  tugAssistanceAmount!: string | null;

  @Column({ name: 'transport_ls', type: 'text', nullable: true })
  transportLs!: string | null;

  @Column({ name: 'transport_quarantine', type: 'text', nullable: true })
  transportQuarantine!: string | null;

  @Column({ name: 'other_info', type: 'text', nullable: true })
  otherInfo!: string | null;

  @Column({ name: 'quote_form', type: 'varchar', length: 10, nullable: true })
  quoteForm!: string | null;

  @Column({ name: 'berth_hours', type: 'decimal', precision: 10, scale: 2, nullable: true })
  berthHours!: string | null;

  @Column({ name: 'anchorage_hours', type: 'decimal', precision: 10, scale: 2, nullable: true })
  anchorageHours!: string | null;

  @Column({ name: 'pilotage_3rd_miles', type: 'decimal', precision: 10, scale: 2, nullable: true })
  pilotage3rdMiles!: string | null;

  // Internal-only EPDA pricing / template inputs (never returned on customer APIs).
  @Column({ name: 'epda_document_date', type: 'date', nullable: true })
  epdaDocumentDate!: string | null;

  @Column({ name: 'ship_type', type: 'varchar', length: 64, nullable: true })
  shipType!: string | null;

  @Column({
    name: 'ocean_frt_rate_usd_per_mt',
    type: 'decimal',
    precision: 15,
    scale: 4,
    nullable: true,
  })
  oceanFrtRateUsdPerMt!: string | null;

  @Column({ name: 'garbage_cbm_amount', type: 'decimal', precision: 15, scale: 4, nullable: true })
  garbageCbmAmount!: string | null;

  @Column({ name: 'garbage_usd_rate', type: 'decimal', precision: 15, scale: 4, nullable: true })
  garbageUsdRate!: string | null;

  @Column({ name: 'quarantine_cargo_mode', type: 'varchar', length: 32, nullable: true })
  quarantineCargoMode!: string | null;

  @Column({ name: 'agency_fee_mode', type: 'varchar', length: 64, nullable: true })
  agencyFeeMode!: string | null;

  @Column({
    name: 'agency_discount_percent',
    type: 'decimal',
    precision: 8,
    scale: 2,
    nullable: true,
  })
  agencyDiscountPercent!: string | null;

  @Column({
    name: 'agency_lumpsum_amount',
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  agencyLumpsumAmount!: string | null;

  @Column({ name: 'epda_snapshot', type: 'jsonb', nullable: true })
  epdaSnapshot!: Record<string, unknown> | null;

  /** Immutable copy of customer-portal field values at submit time. */
  @Column({ name: 'customer_submitted_snapshot', type: 'jsonb', nullable: true })
  customerSubmittedSnapshot!: Record<string, string> | null;

  @Column({ name: 'quoted_at', type: 'timestamptz', nullable: true })
  quotedAt!: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'quoted_by_user_id' })
  quotedBy!: User | null;

  @Column({ name: 'quoted_by_user_id', type: 'bigint', nullable: true })
  quotedByUserId!: number | null;
}
