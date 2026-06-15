import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ShippingAgencyInquiryEntity } from './shipping-agency-inquiry.entity';
import { User } from '../../auth/entities/user.entity';

export enum InquiryFieldChangeAction {
  EPDA_CREATE = 'EPDA_CREATE',
  EPDA_SAVE_DRAFT = 'EPDA_SAVE_DRAFT',
  EPDA_ISSUE = 'EPDA_ISSUE',
}

@Entity('shipping_agency_field_change_logs')
export class InquiryFieldChangeLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @Column({ name: 'inquiry_id', type: 'bigint' })
  inquiryId!: number;

  @ManyToOne(() => ShippingAgencyInquiryEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inquiry_id' })
  inquiry!: ShippingAgencyInquiryEntity;

  @Column({ name: 'changed_by_user_id', type: 'bigint' })
  changedByUserId!: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'changed_by_user_id' })
  changedBy!: User;

  @Column({ type: 'varchar', length: 32 })
  action!: InquiryFieldChangeAction;

  @Column({ name: 'field_name', type: 'varchar', length: 64 })
  fieldName!: string;

  @Column({ name: 'previous_value', type: 'text', nullable: true })
  previousValue!: string | null;

  @Column({ name: 'new_value', type: 'text', nullable: true })
  newValue!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
