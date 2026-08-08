import {
  Column,
  CreateDateColumn,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { BookingDocumentStatus } from '../enums/booking-document-status.enum';

/**
 * Lifecycle fields shared by every persisted booking document.
 *
 * Concrete records intentionally use separate tables and independent bigint
 * sequences. The editable payload remains the source of truth; searchable
 * document fields on concrete entities are generated from it by PostgreSQL.
 */
export abstract class BookingDocumentRecordBase {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  /** Optimistic concurrency token; concurrent writers lose with HTTP 409. */
  @VersionColumn({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({
    type: 'varchar',
    length: 20,
    default: BookingDocumentStatus.PROCESSING,
  })
  status!: BookingDocumentStatus;

  @Column({ name: 'created_by_user_id', type: 'int' })
  createdByUserId!: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy?: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_by_user_id', type: 'int', nullable: true })
  updatedByUserId!: number | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'updated_by_user_id' })
  updatedBy?: User | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @Column({ name: 'deleted_by_user_id', type: 'int', nullable: true })
  deletedByUserId!: number | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'deleted_by_user_id' })
  deletedBy?: User | null;
}
