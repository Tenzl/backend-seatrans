import { Column, CreateDateColumn, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../../auth/entities/user.entity';

export abstract class BaseInquiry {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'user_id', type: 'bigint' })
  userId!: string;

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
  processedById!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;
}
