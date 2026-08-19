import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ServiceType } from '../../logistics/entities/service-type.entity';

@Entity('commodity_types')
@Index('idx_commodity_types_service_type_id', ['serviceTypeId'])
@Index('uq_commodity_types_service_name_normalized', { synchronize: false })
export class CommodityType {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'service_type_id', type: 'int' })
  serviceTypeId!: number;

  @ManyToOne(() => ServiceType, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_type_id' })
  serviceType?: ServiceType;

  @Column({ length: 200 })
  name!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
