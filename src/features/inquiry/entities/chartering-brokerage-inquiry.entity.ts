import { Entity, Column, Index } from 'typeorm';
import { BaseInquiry } from './base-inquiry.entity';

@Entity('chartering_broking_inquiries')
@Index(['laycanFrom', 'laycanTo'])
export class CharteringBrokerageInquiryEntity extends BaseInquiry {
  @Column({ name: 'cargo_quantity', type: 'varchar', length: 255 })
  cargoQuantity!: string;

  @Column({ name: 'loading_port', type: 'varchar', length: 255 })
  loadingPort!: string;

  @Column({ name: 'discharging_port', type: 'varchar', length: 255 })
  dischargingPort!: string;

  @Column({ name: 'laycan_from', type: 'date' })
  laycanFrom!: Date;

  @Column({ name: 'laycan_to', type: 'date' })
  laycanTo!: Date;

  @Column({ name: 'other_info', type: 'text', nullable: true })
  otherInfo!: string | null;
}
