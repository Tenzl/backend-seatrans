import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BookingShippingService } from '../services/booking-shipping.service';
import { UpsertBookingShippingDto } from '../dto/upsert-booking-shipping.dto';
import { AdminSection } from '../../../shared/decorators/admin-section.decorator';

@AdminSection('booking-shipment')
@Controller('v1/admin/booking-management/partners/:partnerId/shipping')
export class AdminBookingShippingController {
  constructor(private readonly bookingShippingService: BookingShippingService) {}

  @Get()
  getShipping(@Param('partnerId', ParseIntPipe) partnerId: number) {
    return this.bookingShippingService.getByPartnerId(partnerId);
  }

  @Put()
  upsertShipping(
    @Param('partnerId', ParseIntPipe) partnerId: number,
    @Body() dto: UpsertBookingShippingDto,
  ) {
    return this.bookingShippingService.upsert(partnerId, dto);
  }
}
