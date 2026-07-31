import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingPartner } from './entities/booking-partner.entity';
import { BookingPartnerAdditionTypeEntity } from './entities/booking-partner-addition-type.entity';
import { BookingPartnerFieldChangeLog } from './entities/booking-partner-field-change-log.entity';
import { BookingShipping } from './entities/booking-shipping.entity';
import { BookingTransitPort } from './entities/booking-transit-port.entity';
import { Port } from '../ports/entities/port.entity';
import { BookingPartnerService } from './services/booking-partner.service';
import { BookingPartnerImportService } from './services/booking-partner-import.service';
import { BookingPartnerFieldChangeService } from './services/booking-partner-field-change.service';
import { BookingShippingService } from './services/booking-shipping.service';
import { AdminBookingPartnerController } from './controllers/admin-booking-partner.controller';
import { AdminBookingShippingController } from './controllers/admin-booking-shipping.controller';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BookingPartner,
      BookingPartnerAdditionTypeEntity,
      BookingPartnerFieldChangeLog,
      BookingShipping,
      BookingTransitPort,
      Port,
    ]),
  ],
  providers: [
    BookingPartnerService,
    BookingPartnerImportService,
    BookingPartnerFieldChangeService,
    BookingShippingService,
    RolesGuard,
  ],
  controllers: [AdminBookingPartnerController, AdminBookingShippingController],
  exports: [BookingPartnerService, BookingShippingService],
})
export class BookingModule {}
