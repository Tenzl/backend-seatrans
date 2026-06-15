import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApproveStatus } from '../enums/approve-status.enum';
import { CustomerStatus } from '../enums/customer-status.enum';
import { CustomerType } from '../enums/customer-type.enum';
import { PartnerContact } from '../types/partner-contact';
import { BookingPartnerAdditionTypeEntity } from './booking-partner-addition-type.entity';
import { BookingShipping } from './booking-shipping.entity';

@Entity('booking_partners')
export class BookingPartner {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ nullable: false })
  name!: string;

  @Column({ name: 'customer_id', unique: true, length: 32 })
  customerId!: string;

  @OneToMany(
    () => BookingPartnerAdditionTypeEntity,
    (additionTypeRow) => additionTypeRow.partner,
    {
      cascade: true,
      eager: true,
      orphanedRowAction: 'delete',
    },
  )
  additionTypeRows!: BookingPartnerAdditionTypeEntity[];

  @Column({ type: 'varchar', length: 128, nullable: true })
  country!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  city!: string | null;

  /** Zero or many contact persons; see {@link PartnerContact}. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  contacts!: PartnerContact[];

  @Column({ type: 'varchar', length: 64, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  fax!: string | null;

  @Column({ name: 'tracking_url', type: 'varchar', length: 512, nullable: true })
  trackingUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @Column({
    name: 'customer_status',
    type: 'enum',
    enum: CustomerStatus,
    nullable: true,
  })
  customerStatus!: CustomerStatus | null;

  @Column({
    name: 'customer_type',
    type: 'enum',
    enum: CustomerType,
    nullable: true,
  })
  customerType!: CustomerType | null;

  @Column({ name: 'tax_number', type: 'varchar', length: 128, nullable: true })
  taxNumber!: string | null;

  @Column({
    name: 'approve_status',
    type: 'enum',
    enum: ApproveStatus,
    nullable: true,
  })
  approveStatus!: ApproveStatus | null;

  @Column({ name: 'approve_by', type: 'varchar', length: 255, nullable: true })
  approveBy!: string | null;

  @Column({ name: 'company_establishment_date', type: 'date', nullable: true })
  companyEstablishmentDate!: string | null;

  @Column({ name: 'payment_due_days', type: 'int', nullable: true })
  paymentDueDays!: number | null;

  @Column({ name: 'contract_no', type: 'varchar', length: 128, nullable: true })
  contractNo!: string | null;

  @Column({ name: 'invoice_company_name', type: 'varchar', length: 255, nullable: true })
  invoiceCompanyName!: string | null;

  @Column({ name: 'invoice_company_address', type: 'text', nullable: true })
  invoiceCompanyAddress!: string | null;

  @Column({ name: 'invoice_company_phone', type: 'varchar', length: 64, nullable: true })
  invoiceCompanyPhone!: string | null;

  @Column({ name: 'invoice_company_email', type: 'varchar', length: 255, nullable: true })
  invoiceCompanyEmail!: string | null;

  @Column({ name: 'invoice_bank_name', type: 'varchar', length: 255, nullable: true })
  invoiceBankName!: string | null;

  @Column({ name: 'invoice_bank_branch', type: 'varchar', length: 255, nullable: true })
  invoiceBankBranch!: string | null;

  @Column({ name: 'invoice_bank_account', type: 'varchar', length: 128, nullable: true })
  invoiceBankAccount!: string | null;

  @Column({ name: 'created_by', length: 255, default: 'system' })
  createdBy!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'updated_by', length: 255, default: 'system' })
  updatedBy!: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  @OneToOne(() => BookingShipping, (shipping) => shipping.bookingPartner)
  shipping!: BookingShipping | null;
}
