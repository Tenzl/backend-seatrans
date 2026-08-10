import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Province } from '../../provinces/entities/province.entity';

export const PORT_TYPES = ['PORT', 'DEPORT'] as const;
export type PortType = (typeof PORT_TYPES)[number];

@Entity('ports')
export class Port {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ length: 100 })
  name!: string;

  @Column({ name: 'port_of_call', length: 100 })
  portOfCall!: string;

  @ManyToOne(() => Province, (province) => province.ports, { nullable: true })
  @JoinColumn({ name: 'province_id' })
  province!: Province | null;

  @Column({ name: 'zone_code', type: 'varchar', length: 50, nullable: true })
  zoneCode!: string | null;

  @Column({
    name: 'longitude',
    type: 'decimal',
    precision: 15,
    scale: 8,
    nullable: true,
  })
  longitude!: string | null;

  @Column({
    name: 'latitude',
    type: 'decimal',
    precision: 15,
    scale: 8,
    nullable: true,
  })
  latitude!: string | null;

  @Column({ name: 'country_code', type: 'varchar', length: 10, nullable: true })
  countryCode!: string | null;

  @Column({ name: 'code', type: 'varchar', length: 50, nullable: true })
  code!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'PORT' })
  type!: PortType;

  @Column({ name: 'in_charge', default: false })
  inCharge!: boolean;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ name: 'has_info', default: 0 })
  hasInfo!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
