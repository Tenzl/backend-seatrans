import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('service_types')
export class ServiceType {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true, length: 100 })
  name!: string;

  @Column({ name: 'display_name', length: 200 })
  displayName!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
