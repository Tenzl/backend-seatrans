import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
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

  /** Immutable form snapshot used to reproduce the created document. */
  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'created_by_user_id', type: 'int' })
  createdByUserId!: number;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy?: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
