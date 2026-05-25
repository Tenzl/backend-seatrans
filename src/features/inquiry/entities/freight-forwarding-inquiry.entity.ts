import { Entity, Column, Index } from 'typeorm';
import { BaseInquiry } from './base-inquiry.entity';

@Entity('freight_forwarding_inquiries')
@Index(['loadingPort', 'dischargingPort'])
@Index(['shipmentFrom', 'shipmentTo'])
export class FreightForwardingInquiryEntity extends BaseInquiry {
  @Column({ name: 'cargo_name', type: 'varchar', length: 255 })
  cargoName!: string;

  @Column({ name: 'delivery_term', type: 'varchar', length: 100 })
  deliveryTerm!: string;

  @Column({ name: 'container_20ft', type: 'int', default: 0 })
  container20ft!: number;

  @Column({ name: 'container_40ft', type: 'int', default: 0 })
  container40ft!: number;

  @Column({ name: 'loading_port', type: 'varchar', length: 255 })
  loadingPort!: string;

  @Column({ name: 'discharging_port', type: 'varchar', length: 255 })
  dischargingPort!: string;

  @Column({ name: 'shipment_from', type: 'date' })
  shipmentFrom!: Date;

  @Column({ name: 'shipment_to', type: 'date' })
  shipmentTo!: Date;
}