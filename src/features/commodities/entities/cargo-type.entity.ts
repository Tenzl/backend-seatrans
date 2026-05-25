import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('cargo_types')
export class CargoTypeEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  code!: string;

  @PrimaryColumn({ name: 'service_type_type', type: 'varchar', length: 100 })
  serviceTypeType!: string;

  @Column({ name: 'display_label', type: 'varchar', length: 120 })
  displayLabel!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
