import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Role } from './role.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true, length: 100 })
  email!: string;

  @Column({ type: 'varchar', unique: true, length: 50, nullable: true })
  username!: string | null;

  @Column({ length: 255 })
  password?: string;

  @Column({ name: 'full_name', length: 100, nullable: true })
  fullName!: string;

  @Column({ length: 20, nullable: true })
  phone!: string;

  @Column({ length: 255, nullable: true })
  company!: string;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'last_login', type: 'timestamp', nullable: true })
  lastLogin!: Date;

  @Column({ name: 'oauth_provider', length: 50, nullable: true })
  oauthProvider!: string; // 'google', 'facebook', etc.

  @Column({ name: 'oauth_provider_id', length: 255, nullable: true })
  oauthProviderId!: string;

  @Column({ name: 'email_verified', default: false })
  emailVerified!: boolean;

  @ManyToOne(() => Role, (role) => role.users, { eager: true, nullable: true })
  @JoinColumn({ name: 'role_id' })
  role!: Role;

  @Column({ name: 'created_by_user_id', type: 'int', nullable: true })
  createdByUserId!: number | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser!: User | null;

  hasRole(roleName: string): boolean {
    return this.role?.name === roleName;
  }

  isInternal(): boolean {
    return this.role?.roleGroup === 'INTERNAL';
  }

  isExternal(): boolean {
    return this.role?.roleGroup === 'EXTERNAL';
  }
}
