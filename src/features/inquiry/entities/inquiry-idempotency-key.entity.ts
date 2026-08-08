import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';

export const INQUIRY_SUBMIT_OPERATION = 'submit_inquiry';

@Entity('inquiry_idempotency_keys')
export class InquiryIdempotencyKey {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: number;

  @Column({ type: 'varchar', length: 64, default: INQUIRY_SUBMIT_OPERATION })
  operation!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ name: 'response_json', type: 'jsonb', nullable: true })
  responseJson!: Record<string, unknown> | null;

  @Column({ name: 'inquiry_id', type: 'bigint', nullable: true })
  inquiryId!: number | null;

  @Column({ name: 'service_slug', type: 'varchar', length: 64, nullable: true })
  serviceSlug!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
