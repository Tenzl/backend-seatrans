import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ServiceType } from '../../logistics/entities/service-type.entity';
import { User } from '../../auth/entities/user.entity';

@Entity('service_inquiries')
export class ServiceInquiry {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @ManyToOne(() => ServiceType, { nullable: false })
  @JoinColumn({ name: 'service_type_id' })
  serviceType!: ServiceType;

  @Column({ name: 'service_type_id', type: 'bigint' })
  serviceTypeId!: number;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ name: 'full_name', type: 'varchar', length: 255, nullable: true })
  fullName!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  company!: string | null;

  @Column({ type: 'varchar', length: 50, default: 'PROCESSING' })
  status!: string;

  @CreateDateColumn({ name: 'submitted_at' })
  submittedAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'processed_by' })
  processedBy!: User | null;

  @Column({ name: 'processed_by', type: 'bigint', nullable: true })
  processedById!: number | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  // Shipping Agency fields
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

  // Chartering fields
  @Column({ name: 'loading_port', type: 'varchar', length: 255, nullable: true })
  loadingPort!: string | null;

  @Column({ name: 'discharging_port', type: 'varchar', length: 255, nullable: true })
  dischargingPort!: string | null;

  @Column({ name: 'laycan_from', type: 'date', nullable: true })
  laycanFrom!: string | null;

  @Column({ name: 'laycan_to', type: 'date', nullable: true })
  laycanTo!: string | null;

  // Freight / Total Logistics fields
  @Column({ name: 'delivery_term', type: 'varchar', length: 100, nullable: true })
  deliveryTerm!: string | null;

  @Column({ name: 'container_20ft', type: 'int', nullable: true })
  container20ft!: number | null;

  @Column({ name: 'container_40ft', type: 'int', nullable: true })
  container40ft!: number | null;

  @Column({ name: 'shipment_from', type: 'date', nullable: true })
  shipmentFrom!: string | null;

  @Column({ name: 'shipment_to', type: 'date', nullable: true })
  shipmentTo!: string | null;

  // Special Request fields
  @Column({ type: 'varchar', length: 500, nullable: true })
  subject!: string | null;

  @Column({ name: 'preferred_province_id', type: 'bigint', nullable: true })
  preferredProvinceId!: number | null;

  @Column({ name: 'related_department_id', type: 'bigint', nullable: true })
  relatedDepartmentId!: number | null;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Column({ name: 'details', type: 'json', nullable: true })
  details!: Record<string, unknown> | null;
}

