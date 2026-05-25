import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  ParseFilePipe,
  MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { BookingPartnerService } from '../services/booking-partner.service';
import { BookingPartnerImportService } from '../services/booking-partner-import.service';
import { ListBookingPartnersDto } from '../dto/list-booking-partners.dto';
import { ListPartnerOptionsQueryDto } from '../dto/list-partner-options-query.dto';
import { UpsertBookingPartnerDto } from '../dto/upsert-booking-partner.dto';
import { UpdateCustomerStatusDto } from '../dto/update-customer-status.dto';
import { Request } from 'express';

type AuthenticatedRequest = Request & {
  user?: {
    email?: string;
    fullName?: string;
  };
};

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ROLE_ADMIN', 'ROLE_EMPLOYEE', 'ROLE_INTERNAL')
@Controller('v1/admin/booking-management/partners')
export class AdminBookingPartnerController {
  constructor(
    private readonly bookingPartnerService: BookingPartnerService,
    private readonly importService: BookingPartnerImportService,
  ) {}

  @Get('import/template')
  getImportTemplate() {
    return this.importService.getTemplate();
  }

  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file'))
  previewImport(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 })],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.importService.preview(file.buffer);
  }

  @Post('import/commit')
  @UseInterceptors(FileInterceptor('file'))
  commitImport(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 })],
      }),
    )
    file: Express.Multer.File,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.importService.commit(file.buffer, this.currentActor(req));
  }

  @Get('options')
  listPartnerOptions(@Query() query: ListPartnerOptionsQueryDto) {
    return this.bookingPartnerService.listPartnerOptions(query.q, query.limit);
  }

  @Get()
  listPartners(@Query() query: ListBookingPartnersDto) {
    return this.bookingPartnerService.listPartners(query);
  }

  @Get(':id')
  getPartner(
    @Param('id', ParseIntPipe) id: number,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const shouldIncludeArchived = includeArchived == null ? true : includeArchived === 'true';
    return this.bookingPartnerService.getDetail(id, shouldIncludeArchived);
  }

  @Post()
  createPartner(@Body() dto: UpsertBookingPartnerDto, @Req() req: AuthenticatedRequest) {
    return this.bookingPartnerService.createPartner(dto, this.currentActor(req));
  }

  @Put(':id')
  updatePartner(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertBookingPartnerDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookingPartnerService.updatePartner(id, dto, this.currentActor(req));
  }

  @Patch(':id/customer-status')
  updateCustomerStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookingPartnerService.updateCustomerStatus(id, dto, this.currentActor(req));
  }

  @Delete(':id')
  removePartner(@Param('id', ParseIntPipe) id: number) {
    return this.bookingPartnerService.delete(id);
  }

  private currentActor(req: AuthenticatedRequest): string {
    return req.user?.email ?? req.user?.fullName ?? 'system';
  }
}
