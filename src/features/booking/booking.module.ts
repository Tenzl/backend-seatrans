import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingPartner } from './entities/booking-partner.entity';
import { BookingPartnerAdditionTypeEntity } from './entities/booking-partner-addition-type.entity';
import { BookingShipping } from './entities/booking-shipping.entity';
import { BookingTransitPort } from './entities/booking-transit-port.entity';
import { Port } from '../ports/entities/port.entity';
import { BookingPartnerService } from './services/booking-partner.service';
import { BookingPartnerImportService } from './services/booking-partner-import.service';
import { BookingShippingService } from './services/booking-shipping.service';
import { AdminBookingPartnerController } from './controllers/admin-booking-partner.controller';
import { AdminBookingShippingController } from './controllers/admin-booking-shipping.controller';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BookingPartner,
      BookingPartnerAdditionTypeEntity,
      BookingShipping,
      BookingTransitPort,
      Port,
    ]),
  ],
  providers: [
    BookingPartnerService,
    BookingPartnerImportService,
    BookingShippingService,
    RolesGuard,
  ],
  controllers: [AdminBookingPartnerController, AdminBookingShippingController],
  exports: [BookingPartnerService, BookingShippingService],
})
export class BookingModule {}
