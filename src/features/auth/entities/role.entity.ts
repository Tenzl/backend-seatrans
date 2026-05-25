import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { User } from './user.entity';
import { RoleGroup } from '../enums/role-group.enum';

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true, length: 50 })
  name!: string;

  @Column({ length: 255, nullable: true })
  description!: string;

  @Column({
    type: 'enum',
    enum: RoleGroup,
    name: 'role_group',
  })
  roleGroup!: RoleGroup;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => User, (user) => user.role)
  users!: User[];
}
