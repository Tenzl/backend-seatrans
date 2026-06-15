import { Entity, Column, Index } from 'typeorm';
import { BaseInquiry } from './base-inquiry.entity';

@Entity('total_logistics_inquiries')
@Index(['loadingPort', 'dischargingPort'])
@Index(['shipmentFrom', 'shipmentTo'])
export class TotalLogisticsInquiryEntity extends BaseInquiry {
  @Column({ name: 'cargo_name', type: 'varchar', length: 255, nullable: true })
  cargoName!: string | null;

  @Column({ name: 'delivery_term', type: 'varchar', length: 100, nullable: true })
  deliveryTerm!: string | null;

  @Column({ name: 'container_20ft', type: 'int', nullable: true })
  container20ft!: number | null;

  @Column({ name: 'container_40ft', type: 'int', nullable: true })
  container40ft!: number | null;

  @Column({ name: 'loading_port', type: 'varchar', length: 255, nullable: true })
  loadingPort!: string | null;

  @Column({ name: 'discharging_port', type: 'varchar', length: 255, nullable: true })
  dischargingPort!: string | null;

  @Column({ name: 'shipment_from', type: 'date', nullable: true })
  shipmentFrom!: string | null;

  @Column({ name: 'shipment_to', type: 'date', nullable: true })
  shipmentTo!: string | null;
}
