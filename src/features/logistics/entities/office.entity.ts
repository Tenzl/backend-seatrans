import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Province } from '../../provinces/entities/province.entity';

@Entity('offices')
export class Office {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Province, { nullable: false })
  @JoinColumn({ name: 'province_id' })
  province!: Province;

  @Column({ length: 255 })
  name!: string;

  @Column({ type: 'text' })
  address!: string;

  @Column({ name: 'map_url', type: 'text', nullable: true })
  mapUrl!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude!: string | null;

  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude!: string | null;

  @Column({ name: 'manager_name', type: 'varchar', length: 255, nullable: true })
  managerName!: string | null;

  @Column({ name: 'manager_title', type: 'varchar', length: 255, nullable: true })
  managerTitle!: string | null;

  @Column({ name: 'manager_mobile', type: 'varchar', length: 50, nullable: true })
  managerMobile!: string | null;

  @Column({ name: 'manager_email', type: 'varchar', length: 255, nullable: true })
  managerEmail!: string | null;

  @Column({ name: 'is_headquarter', default: false })
  isHeadquarter!: boolean;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
