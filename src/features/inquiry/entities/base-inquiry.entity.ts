import {
  Column,
  CreateDateColumn,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ServiceType } from '../../logistics/entities/service-type.entity';
import { User } from '../../auth/entities/user.entity';
import { InquiryCreatedSource } from '../enums/inquiry-created-source.enum';

/**
 * Fields common to every per-service inquiry table.
 *
 * Each concrete entity maps to its own table but shares this column set. The
 * primary key draws from a single shared Postgres sequence (`inquiry_global_id_seq`,
 * applied via DDL bootstrap) so inquiry ids stay globally unique across all
 * service tables — documents, notifications and audit logs reference an inquiry
 * by bare id, so a per-table sequence would let ids collide.
 */
export abstract class BaseInquiry {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @Column({ type: 'varchar', length: 20, unique: true, nullable: true })
  code!: string | null;

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

  @Column({
    name: 'created_source',
    type: 'varchar',
    length: 32,
    default: InquiryCreatedSource.CUSTOMER_PORTAL,
  })
  createdSource!: InquiryCreatedSource;

  @Column({ name: 'details', type: 'json', nullable: true })
  details!: Record<string, unknown> | null;
}
