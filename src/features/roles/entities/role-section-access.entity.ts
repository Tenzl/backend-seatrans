import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
} from 'typeorm';
import { Role } from '../../auth/entities/role.entity';

/**
 * Which dashboard sections a role may access. One row per (role, section_key).
 * Rows are deleted with their role (FK ON DELETE CASCADE in the migration).
 */
@Entity('role_section_access')
@Index('uq_role_section', ['roleId', 'sectionKey'], { unique: true })
export class RoleSectionAccess {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'role_id', type: 'int' })
  roleId!: number;

  @ManyToOne(() => Role, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'role_id' })
  role!: Role;

  @Column({ name: 'section_key', type: 'varchar', length: 64 })
  sectionKey!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
