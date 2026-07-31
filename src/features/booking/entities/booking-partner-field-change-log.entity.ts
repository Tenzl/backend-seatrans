import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { BookingPartner } from './booking-partner.entity';

export enum BookingPartnerFieldChangeAction {
  PARTNER_CREATE = 'PARTNER_CREATE',
  PARTNER_UPDATE = 'PARTNER_UPDATE',
  PARTNER_LOCK = 'PARTNER_LOCK',
}

@Entity('booking_partner_field_change_logs')
export class BookingPartnerFieldChangeLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @Column({ name: 'partner_id', type: 'bigint' })
  partnerId!: number;

  @ManyToOne(() => BookingPartner, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'partner_id' })
  partner!: BookingPartner;

  @Column({ name: 'changed_by_user_id', type: 'bigint' })
  changedByUserId!: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'changed_by_user_id' })
  changedBy!: User;

  @Column({ type: 'varchar', length: 32 })
  action!: BookingPartnerFieldChangeAction;

  @Column({ name: 'field_name', type: 'varchar', length: 64 })
  fieldName!: string;

  @Column({ name: 'previous_value', type: 'text', nullable: true })
  previousValue!: string | null;

  @Column({ name: 'new_value', type: 'text', nullable: true })
  newValue!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
