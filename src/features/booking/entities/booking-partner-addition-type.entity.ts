import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { PartnerAdditionType } from '../enums/partner-addition-type.enum';
import { BookingPartner } from './booking-partner.entity';

@Entity('booking_partner_addition_types')
export class BookingPartnerAdditionTypeEntity {
  @PrimaryColumn({ name: 'partner_id', type: 'int' })
  partnerId!: number;

  @PrimaryColumn({
    name: 'addition_type',
    type: 'enum',
    enum: PartnerAdditionType,
  })
  additionType!: PartnerAdditionType;

  @ManyToOne(() => BookingPartner, (partner) => partner.additionTypeRows, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'partner_id' })
  partner!: BookingPartner;
}
