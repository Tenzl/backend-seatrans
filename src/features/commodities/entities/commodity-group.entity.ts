import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ServiceType } from '../../logistics/entities/service-type.entity';
import { Commodity } from './commodity.entity';

@Entity('commodity_groups')
@Index('uq_commodity_groups_service_name', ['serviceTypeId', 'name'], {
  unique: true,
})
export class CommodityGroup {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'service_type_id' })
  serviceTypeId!: number;

  @ManyToOne(() => ServiceType, { nullable: false })
  @JoinColumn({ name: 'service_type_id' })
  serviceType?: ServiceType;

  /** Unique per service_type_id; renamable via PATCH. */
  @Column({ length: 200 })
  name!: string;

  @OneToMany(() => Commodity, (commodity) => commodity.group)
  commodities?: Commodity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
