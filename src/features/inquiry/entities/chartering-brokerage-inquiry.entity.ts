import { Entity, Column, Index } from 'typeorm';
import { BaseInquiry } from './base-inquiry.entity';

@Entity('chartering_broking_inquiries')
@Index(['laycanFrom', 'laycanTo'])
export class CharteringBrokerageInquiryEntity extends BaseInquiry {
  @Column({ name: 'cargo_quantity', type: 'varchar', length: 255, nullable: true })
  cargoQuantity!: string | null;

  @Column({ name: 'loading_port', type: 'varchar', length: 255, nullable: true })
  loadingPort!: string | null;

  @Column({ name: 'discharging_port', type: 'varchar', length: 255, nullable: true })
  dischargingPort!: string | null;

  @Column({ name: 'laycan_from', type: 'date', nullable: true })
  laycanFrom!: string | null;

  @Column({ name: 'laycan_to', type: 'date', nullable: true })
  laycanTo!: string | null;

  @Column({ name: 'other_info', type: 'text', nullable: true })
  otherInfo!: string | null;
}
