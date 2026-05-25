import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BookingShipping } from './booking-shipping.entity';
import { Port } from '../../ports/entities/port.entity';

@Entity('booking_transit_ports')
export class BookingTransitPort {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => BookingShipping, (bookingShipping) => bookingShipping.transitPorts, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'booking_shipping_id' })
  bookingShipping!: BookingShipping;

  @Column({ name: 'sort_order', nullable: false })
  sortOrder!: number;

  @ManyToOne(() => Port, { nullable: false })
  @JoinColumn({ name: 'port_id' })
  port!: Port;

  @Column({ type: 'timestamp', nullable: true })
  eta!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  etd!: Date | null;
}
