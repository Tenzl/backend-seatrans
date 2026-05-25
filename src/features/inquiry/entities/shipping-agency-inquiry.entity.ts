import { Entity, Column } from 'typeorm';
import { BaseInquiry } from './base-inquiry.entity';

@Entity('shipping_agency_inquiries')
export class ShippingAgencyInquiryEntity extends BaseInquiry {
  @Column({ name: 'shipowner_to', type: 'varchar', length: 255, nullable: true })
  toName!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  mv!: string | null;

  @Column({ type: 'date', nullable: true })
  eta!: Date | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  dwt!: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  grt!: number | null;

  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  loa!: number | null;

  @Column({ name: 'cargo_type', type: 'varchar', length: 255, nullable: true })
  cargoType!: string | null;

  @Column({ name: 'cargo_name', type: 'varchar', length: 255, nullable: true })
  cargoName!: string | null;

  @Column({ name: 'cargo_name_other', type: 'varchar', length: 255, nullable: true })
  cargoNameOther!: string | null;

  @Column({ name: 'cargo_quantity', type: 'decimal', precision: 15, scale: 3, nullable: true })
  cargoQuantity!: number | null;

  @Column({ name: 'port_of_call', type: 'varchar', length: 255, nullable: true })
  portOfCall!: string | null;

  @Column({ name: 'discharge_loading_location', type: 'varchar', length: 64, nullable: true })
  dischargeLoadingLocation!: string | null;

  @Column({ name: 'other_info', type: 'text', nullable: true })
  otherInfo!: string | null;

  @Column({ name: 'transport_ls', type: 'text', nullable: true })
  transportLs!: string | null;

  @Column({ name: 'transport_quarantine', type: 'text', nullable: true })
  transportQuarantine!: string | null;

  @Column({ name: 'frt_tax_type', type: 'varchar', length: 64, nullable: true })
  frtTaxType!: string | null;

  @Column({ name: 'purpose_of_calling', type: 'varchar', length: 64, nullable: true })
  purposeOfCalling!: string | null;

  @Column({ name: 'boat_hire_amount', type: 'decimal', precision: 15, scale: 2, nullable: true })
  boatHireAmount!: number | null;

  @Column({ name: 'tally_fee_amount', type: 'decimal', precision: 15, scale: 2, nullable: true })
  tallyFeeAmount!: number | null;

  @Column({ name: 'quote_form', type: 'varchar', length: 10, nullable: true })
  quoteForm!: string | null;

  @Column({ name: 'berth_hours', type: 'decimal', precision: 10, scale: 2, nullable: true })
  berthHours!: number | null;

  @Column({ name: 'anchorage_hours', type: 'decimal', precision: 10, scale: 2, nullable: true })
  anchorageHours!: number | null;

  @Column({ name: 'pilotage_3rd_miles', type: 'decimal', precision: 10, scale: 2, nullable: true })
  pilotage3rdMiles!: number | null;
}
