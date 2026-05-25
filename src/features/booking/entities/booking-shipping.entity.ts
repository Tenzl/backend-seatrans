import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BookingPartner } from './booking-partner.entity';
import { Port } from '../../ports/entities/port.entity';
import { BookingTransitPort } from './booking-transit-port.entity';

@Entity('booking_shipping')
export class BookingShipping {
  @PrimaryGeneratedColumn()
  id!: number;

  @OneToOne(() => BookingPartner, (bookingPartner) => bookingPartner.shipping, {
    nullable: false,
  })
  @JoinColumn({ name: 'booking_partner_id' })
  bookingPartner!: BookingPartner;

  @Column({ name: 'booking_no', type: 'varchar', length: 128, nullable: true })
  bookingNo!: string | null;

  @Column({ name: 'booking_to', type: 'varchar', length: 255, nullable: true })
  bookingTo!: string | null;

  @Column({ name: 'booking_number_reference', type: 'varchar', length: 255, nullable: true })
  bookingNumberReference!: string | null;

  @Column({ name: 'booking_note', type: 'text', nullable: true })
  bookingNote!: string | null;

  @Column({ name: 'service_mode', type: 'varchar', length: 128, nullable: true })
  serviceMode!: string | null;

  @ManyToOne(() => Port, { nullable: true })
  @JoinColumn({ name: 'place_of_receipt_port_id' })
  placeOfReceiptPort!: Port | null;

  @ManyToOne(() => Port, { nullable: true })
  @JoinColumn({ name: 'port_of_loading_port_id' })
  portOfLoadingPort!: Port | null;

  @Column({ name: 'pick_up', type: 'varchar', length: 512, nullable: true })
  pickUp!: string | null;

  @Column({ name: 'etd', type: 'timestamp', nullable: true })
  etd!: Date | null;

  @Column({ name: 'date_of_pick_up', type: 'date', nullable: true })
  dateOfPickUp!: string | null;

  @Column({ name: 'drop_off_warehouse', type: 'varchar', length: 512, nullable: true })
  dropOffWarehouse!: string | null;

  @Column({ name: 'feeder_vessel', type: 'varchar', length: 255, nullable: true })
  feederVessel!: string | null;

  @Column({ name: 'feeder_voyage', type: 'varchar', length: 128, nullable: true })
  feederVoyage!: string | null;

  @Column({ name: 'mother_vessel', type: 'varchar', length: 255, nullable: true })
  motherVessel!: string | null;

  @Column({ name: 'mother_voyage', type: 'varchar', length: 128, nullable: true })
  motherVoyage!: string | null;

  @Column({ name: 'provider', type: 'varchar', length: 255, nullable: true })
  provider!: string | null;

  @Column({ name: 'carrier', type: 'varchar', length: 255, nullable: true })
  carrier!: string | null;

  @Column({ name: 'cy_cut_off', type: 'timestamp', nullable: true })
  cyCutOff!: Date | null;

  @Column({ name: 'si_cut_off', type: 'timestamp', nullable: true })
  siCutOff!: Date | null;

  @Column({ name: 'vgm_cut_off', type: 'timestamp', nullable: true })
  vgmCutOff!: Date | null;

  @Column({ name: 'gate_in', type: 'timestamp', nullable: true })
  gateIn!: Date | null;

  @Column({ name: 'temp', type: 'numeric', precision: 12, scale: 4, nullable: true })
  temp!: string | null;

  @Column({ name: 'vent', type: 'varchar', length: 255, nullable: true })
  vent!: string | null;

  @Column({ name: 'freight_terms', type: 'varchar', length: 128, nullable: true })
  freightTerms!: string | null;

  @ManyToOne(() => Port, { nullable: true })
  @JoinColumn({ name: 'port_of_discharge_port_id' })
  portOfDischargePort!: Port | null;

  @ManyToOne(() => Port, { nullable: true })
  @JoinColumn({ name: 'place_of_delivery_port_id' })
  placeOfDeliveryPort!: Port | null;

  @ManyToOne(() => Port, { nullable: true })
  @JoinColumn({ name: 'final_destination_port_id' })
  finalDestinationPort!: Port | null;

  @Column({ name: 'eta', type: 'timestamp', nullable: true })
  eta!: Date | null;

  @Column({ name: 'volume', type: 'varchar', length: 255, nullable: true })
  volume!: string | null;

  @Column({ name: 'cargo_type', type: 'varchar', length: 255, nullable: true })
  cargoType!: string | null;

  @Column({ name: 'cargo_name', type: 'varchar', length: 512, nullable: true })
  cargoName!: string | null;

  @Column({ name: 'gross_weight_kgs', type: 'numeric', precision: 14, scale: 4, nullable: true })
  grossWeightKgs!: string | null;

  @Column({ name: 'measurement_cbm', type: 'numeric', precision: 14, scale: 4, nullable: true })
  measurementCbm!: string | null;

  @Column({ name: 'contact', type: 'varchar', length: 512, nullable: true })
  contact!: string | null;

  @Column({ name: 'special_remark', type: 'varchar', length: 1024, nullable: true })
  specialRemark!: string | null;

  @Column({ name: 'date_of_creation', type: 'date', nullable: true })
  dateOfCreation!: string | null;

  @Column({ name: 'terms_and_conditions', type: 'text', nullable: true })
  termsAndConditions!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => BookingTransitPort, (transitPort) => transitPort.bookingShipping, {
    cascade: true,
    orphanedRowAction: 'delete',
  })
  transitPorts!: BookingTransitPort[];
}
