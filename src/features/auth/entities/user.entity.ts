import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { Role } from './role.entity';
import { RoleGroup } from '../enums/role-group.enum';

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

  /**
   * Monotonic session generation. Embedded in JWTs; bumped on disable, password
   * reset, role change, and logout so previously issued tokens fail closed.
   */
  @Column({ name: 'session_version', type: 'int', default: 1 })
  sessionVersion!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'last_login', type: 'timestamp', nullable: true })
  lastLogin!: Date;

  @Column({
    name: 'oauth_provider',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  oauthProvider!: string | null; // 'google', 'facebook', etc.

  @Column({
    name: 'oauth_provider_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  oauthProviderId!: string | null;

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

  /**
   * Keep the stored value canonical so the ordinary unique index also prevents
   * case-variant duplicates for every repository.save() caller.
   */
  @BeforeInsert()
  @BeforeUpdate()
  normalizeIdentityFields(): void {
    this.email = this.email.trim().toLowerCase();
    if (typeof this.username === 'string') {
      const username = this.username.trim().toLowerCase();
      this.username = username || null;
    }
    const oauthProvider =
      typeof this.oauthProvider === 'string'
        ? this.oauthProvider.trim().toLowerCase()
        : null;
    const oauthProviderId =
      typeof this.oauthProviderId === 'string'
        ? this.oauthProviderId.trim()
        : null;
    // OAuth provider and subject form one identity. A partial or blank pair
    // means that this is a password account, not an indexable OAuth identity.
    this.oauthProvider =
      oauthProvider && oauthProviderId ? oauthProvider : null;
    this.oauthProviderId =
      oauthProvider && oauthProviderId ? oauthProviderId : null;
  }

  hasRole(roleName: string): boolean {
    return this.role?.name === roleName;
  }

  isInternal(): boolean {
    return this.role?.roleGroup === RoleGroup.INTERNAL;
  }

  isExternal(): boolean {
    return this.role?.roleGroup === RoleGroup.EXTERNAL;
  }
}
