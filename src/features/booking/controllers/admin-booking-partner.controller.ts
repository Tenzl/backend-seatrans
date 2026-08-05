import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
  ParseFilePipe,
  MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BookingPartnerService } from '../services/booking-partner.service';
import { BookingPartnerImportService } from '../services/booking-partner-import.service';
import { ListBookingPartnersDto } from '../dto/list-booking-partners.dto';
import { ListPartnerOptionsQueryDto } from '../dto/list-partner-options-query.dto';
import { ListPartnerFieldChangesQueryDto } from '../dto/list-partner-field-changes-query.dto';
import { UpsertBookingPartnerDto } from '../dto/upsert-booking-partner.dto';
import { UpdateCustomerStatusDto } from '../dto/update-customer-status.dto';
import { Request } from 'express';
import { AdminSection } from '../../../shared/decorators/admin-section.decorator';
import { PermanentDelete } from '../../../shared/decorators/permanent-delete.decorator';
import { DeleteAllBookingPartnersDto } from '../dto/delete-all-booking-partners.dto';

type AuthenticatedRequest = Request & {
  user?: {
    id?: number;
    email?: string;
    fullName?: string;
  };
};

@AdminSection('booking-partner')
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
    return this.bookingPartnerService.listPartnerOptions(query);
  }

  @Get()
  listPartners(@Query() query: ListBookingPartnersDto) {
    return this.bookingPartnerService.listPartners(query);
  }

  @Get(':id/field-changes')
  listPartnerFieldChanges(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListPartnerFieldChangesQueryDto,
  ) {
    return this.bookingPartnerService.listFieldChangeLogs(
      id,
      query.page ?? 0,
      query.size ?? 6,
    );
  }

  @Get(':id')
  getPartner(
    @Param('id', ParseIntPipe) id: number,
    @Query('includeArchived') includeArchived?: string,
  ) {
    const shouldIncludeArchived =
      includeArchived == null ? true : includeArchived === 'true';
    return this.bookingPartnerService.getDetail(id, shouldIncludeArchived);
  }

  @Post()
  createPartner(
    @Body() dto: UpsertBookingPartnerDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookingPartnerService.createPartner(
      dto,
      this.currentActor(req),
      this.requireActorUserId(req),
    );
  }

  @Put(':id')
  updatePartner(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertBookingPartnerDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookingPartnerService.updatePartner(
      id,
      dto,
      this.currentActor(req),
      this.requireActorUserId(req),
    );
  }

  @Patch(':id/customer-status')
  updateCustomerStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookingPartnerService.updateCustomerStatus(
      id,
      dto,
      this.currentActor(req),
      this.requireActorUserId(req),
    );
  }

  @Post(':id/lock')
  lockPartner(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bookingPartnerService.lockPartner(
      id,
      this.currentActor(req),
      this.requireActorUserId(req),
    );
  }

  @Delete()
  @PermanentDelete({
    resourceType: 'booking_partner_all',
    detailSources: [{ kind: 'body', key: 'expectedCount' }],
  })
  removeAllPartners(@Body() dto: DeleteAllBookingPartnersDto) {
    return this.bookingPartnerService.deleteAll(dto.expectedCount);
  }

  @Delete(':id')
  @PermanentDelete({
    resourceType: 'booking_partner',
    idSource: { kind: 'param', key: 'id' },
  })
  removePartner(@Param('id', ParseIntPipe) id: number) {
    return this.bookingPartnerService.delete(id);
  }

  private currentActor(req: AuthenticatedRequest): string {
    return req.user?.email ?? req.user?.fullName ?? 'system';
  }

  private requireActorUserId(req: AuthenticatedRequest): number {
    const actorUserId = req.user?.id;
    if (actorUserId == null) {
      throw new BadRequestException('User not authenticated');
    }
    return actorUserId;
  }
}
