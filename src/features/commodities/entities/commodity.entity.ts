import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { CommodityGroup } from './commodity-group.entity';

@Entity('commodities')
/** DB enforces partial unique (group_id, name) WHERE group_id IS NOT NULL. */
@Index('uq_commodities_group_name', ['groupId', 'name'], { unique: true })
export class Commodity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'service_type_id' })
  serviceTypeId: number;

  @Column({ name: 'group_id', type: 'int', nullable: true })
  groupId: number | null;

  @ManyToOne(() => CommodityGroup, (group) => group.commodities, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'group_id' })
  group?: CommodityGroup | null;

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
