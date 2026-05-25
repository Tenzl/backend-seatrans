import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Port } from '../../ports/entities/port.entity';

@Entity('provinces')
export class Province {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true, length: 100 })
  name!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 100, nullable: true })
  displayName!: string | null;

  @Column({ type: 'integer', unique: true, nullable: true })
  code!: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  area!: string | null;

  @OneToMany(() => Port, (port) => port.province)
  ports!: Port[];

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
