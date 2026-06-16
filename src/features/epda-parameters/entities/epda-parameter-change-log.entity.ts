import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type {
  EpdaParameterScope,
  PartialEpdaParameterValues,
} from './epda-parameter-set.entity';
import { User } from '../../auth/entities/user.entity';

export type EpdaParameterChangeAction =
  | 'UPSERT_AREA'
  | 'UPSERT_PORT'
  | 'DELETE_PORT'
  | 'UPSERT_GROUP'
  | 'DELETE_GROUP'
  | 'SET_GROUP_MEMBERS';

/** Audit trail for edits made on the EPDA Parameter screen (area sets + port overrides). */
@Entity('epda_parameter_change_logs')
export class EpdaParameterChangeLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @Column({ type: 'varchar', length: 10 })
  scope!: EpdaParameterScope;

  @Column({ type: 'varchar', length: 50, nullable: true })
  area!: string | null;

  @Column({ name: 'port_id', type: 'int', nullable: true })
  portId!: number | null;

  @Column({ type: 'varchar', length: 20 })
  action!: EpdaParameterChangeAction;

  @Column({ name: 'changed_by_user_id', type: 'bigint', nullable: true })
  changedByUserId!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'changed_by_user_id' })
  changedBy?: User | null;

  @Column({ name: 'before_values', type: 'jsonb', nullable: true })
  beforeValues!: PartialEpdaParameterValues | null;

  @Column({ name: 'after_values', type: 'jsonb', nullable: true })
  afterValues!: PartialEpdaParameterValues | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
