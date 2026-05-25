import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('commodities')
export class Commodity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'service_type_id' })
  serviceTypeId: number;

  @Column({ length: 100 })
  name: string;

  @Column({ name: 'display_name', length: 200 })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'required_image_count', default: 18 })
  requiredImageCount: number;

  @Column({ name: 'cargo_type', length: 100, default: 'IN_BULK' })
  cargoType: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
