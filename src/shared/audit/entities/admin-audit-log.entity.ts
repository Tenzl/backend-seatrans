import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum AdminAuditStatus {
  STARTED = 'STARTED',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

@Entity('admin_audit_logs')
@Index(['actorUserId', 'createdAt'])
@Index(['resourceType', 'resourceId', 'createdAt'])
@Index(['status', 'createdAt'])
export class AdminAuditLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: number;

  @Column({ name: 'request_id', type: 'uuid', unique: true })
  requestId!: string;

  @Column({ name: 'actor_user_id', type: 'bigint', nullable: true })
  actorUserId!: number | null;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ name: 'resource_type', type: 'varchar', length: 96 })
  resourceType!: string;

  @Column({
    name: 'resource_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  resourceId!: string | null;

  @Column({ type: 'varchar', length: 12 })
  method!: string;

  @Column({ name: 'request_path', type: 'varchar', length: 500 })
  requestPath!: string;

  @Column({
    type: 'varchar',
    length: 16,
    enum: AdminAuditStatus,
    default: AdminAuditStatus.STARTED,
  })
  status!: AdminAuditStatus;

  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
