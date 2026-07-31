import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { BookingDocumentStatus } from '../enums/booking-document-status.enum';
import { BookingDocumentType } from '../enums/booking-document-type.enum';

@Entity('booking_document_records')
export class BookingDocumentRecord {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @Column({ name: 'document_type', type: 'varchar', length: 20 })
  documentType!: BookingDocumentType;

  @Column({
    name: 'reference_number',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  referenceNumber!: string | null;

  /**
   * Editable form snapshot used to reproduce the document PDF.
   * Remains the source of truth for Create & Preview regeneration.
   */
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

  /** When set, edits are frozen permanently (no unlock). */
  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  /** Soft-archive timestamp. Hard delete removes the row. */
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @Column({ name: 'deleted_by_user_id', type: 'int', nullable: true })
  deletedByUserId!: number | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'deleted_by_user_id' })
  deletedBy?: User | null;
}
