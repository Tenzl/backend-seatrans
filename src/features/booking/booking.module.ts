import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingPartner } from './entities/booking-partner.entity';
import { BookingPartnerAdditionTypeEntity } from './entities/booking-partner-addition-type.entity';
import { BookingPartnerFieldChangeLog } from './entities/booking-partner-field-change-log.entity';
import { BookingPartnerService } from './services/booking-partner.service';
import { BookingPartnerImportService } from './services/booking-partner-import.service';
import { BookingPartnerFieldChangeService } from './services/booking-partner-field-change.service';
import { AdminBookingPartnerController } from './controllers/admin-booking-partner.controller';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BookingPartner,
      BookingPartnerAdditionTypeEntity,
      BookingPartnerFieldChangeLog,
    ]),
  ],
  providers: [
    BookingPartnerService,
    BookingPartnerImportService,
    BookingPartnerFieldChangeService,
    RolesGuard,
  ],
  controllers: [AdminBookingPartnerController],
  exports: [BookingPartnerService],
})
export class BookingModule {}
