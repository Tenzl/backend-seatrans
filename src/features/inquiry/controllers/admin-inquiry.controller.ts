import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiAdmin } from '../../../shared/decorators/api-admin.decorator';
import { PermanentDelete } from '../../../shared/decorators/permanent-delete.decorator';
import { isAdminRoleName } from '../../roles/section-access.service';
import { ServiceInquiryService } from '../services/service-inquiry.service';
import { ShippingAgencyEpdaService } from '../services/shipping-agency-epda.service';
import { ListInquiriesQueryDto } from '../dto/list-inquiries-query.dto';
import { UpdateInquiryStatusDto } from '../dto/update-inquiry-status.dto';
import { UpdateInquiryFormDto } from '../dto/update-inquiry-form.dto';
import { UpdateInquiryHoursDto } from '../dto/update-inquiry-hours.dto';
import { DeleteInquiriesDto } from '../dto/delete-inquiries.dto';
import { DeleteInquiriesQueryDto } from '../dto/delete-inquiries-query.dto';
import { UpdateShippingAgencyEpdaDto } from '../dto/update-shipping-agency-epda.dto';
import { IssueShippingAgencyEpdaDto } from '../dto/issue-shipping-agency-epda.dto';
import { LockShippingAgencyEpdaDto } from '../dto/lock-shipping-agency-epda.dto';
import { CreateInternalShippingAgencyInquiryDto } from '../dto/create-internal-shipping-agency-inquiry.dto';
import { ListInquiryFieldChangesQueryDto } from '../dto/list-inquiry-field-changes-query.dto';
import { validateDto } from '../../../shared/utils/validate-dto.util';

/**
 * Admin inquiry API.
 * List/filter: GET /v1/admin/inquiries?serviceType=&status=&page=&size=
 * Detail: GET /v1/admin/inquiries/:serviceType/:id
 */
type StaffRequest = Request & {
  user?: { id?: number; role?: { name?: string | null } | null };
};

@ApiAdmin()
@Controller('v1/admin/inquiries')
export class AdminInquiryController {
  constructor(
    private readonly inquiryService: ServiceInquiryService,
    private readonly shippingAgencyEpdaService: ShippingAgencyEpdaService,
  ) {}

  @Get()
  list(@Query() query: ListInquiriesQueryDto, @Req() req: StaffRequest) {
    const includeArchived = isAdminRoleName(req.user?.role?.name);
    return this.inquiryService.listForAdmin(query, { includeArchived });
  }

  @Delete('batch')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteBatch(
    @Body() dto: DeleteInquiriesDto,
    @Query() query: DeleteInquiriesQueryDto,
    @Req() req: StaffRequest,
  ) {
    const actorUserId = req.user?.id;
    if (!actorUserId) {
      throw new BadRequestException('User not authenticated');
    }

    const serviceSlug = query.serviceSlug?.trim() || undefined;
    return this.inquiryService.softDeleteBatch(
      dto.ids,
      actorUserId,
      serviceSlug,
    );
  }

  @Delete('batch/permanent')
  @PermanentDelete({
    resourceType: 'inquiry_batch',
    detailSources: [
      { kind: 'body', key: 'ids', label: 'resourceIds' },
      { kind: 'query', key: 'serviceSlug' },
    ],
  })
  hardDeleteBatch(
    @Body() dto: DeleteInquiriesDto,
    @Query() query: DeleteInquiriesQueryDto,
  ) {
    const serviceSlug = query.serviceSlug?.trim() || undefined;
    return this.inquiryService.hardDeleteBatchByAdmin(dto.ids, serviceSlug);
  }

  @Post('batch/restore')
  restoreBatch(
    @Body() dto: DeleteInquiriesDto,
    @Query() query: DeleteInquiriesQueryDto,
    @Req() req: StaffRequest,
  ) {
    if (!isAdminRoleName(req.user?.role?.name)) {
      throw new ForbiddenException(
        'Only administrators can restore archived inquiries',
      );
    }
    const serviceSlug = query.serviceSlug?.trim() || undefined;
    return this.inquiryService.restoreBatchByAdmin(dto.ids, serviceSlug);
  }

  /**
   * Internal staff: create shipping agency inquiry with EPDA draft fields.
   * POST /api/v1/admin/inquiries/shipping-agency
   */
  @Post('shipping-agency')
  @HttpCode(HttpStatus.CREATED)
  async createShippingAgencyWithEpda(
    @Body() body: CreateInternalShippingAgencyInquiryDto,
    @Req() req: StaffRequest,
  ) {
    const dto = await validateDto(CreateInternalShippingAgencyInquiryDto, body);
    const actorUserId = req.user?.id;
    if (!actorUserId) {
      throw new BadRequestException('User not authenticated');
    }
    return this.shippingAgencyEpdaService.createInternalInquiry(
      dto,
      actorUserId,
    );
  }

  /**
   * Save internal EPDA draft (pricing fields not exposed to customers).
   * PATCH /api/v1/admin/inquiries/shipping-agency/:id/epda
   */
  @Patch('shipping-agency/:id/epda')
  async updateShippingAgencyEpda(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateShippingAgencyEpdaDto,
    @Req() req: StaffRequest,
  ) {
    const dto = await validateDto(UpdateShippingAgencyEpdaDto, body);
    const actorUserId = req.user?.id;
    if (!actorUserId) {
      throw new BadRequestException('User not authenticated');
    }
    return this.shippingAgencyEpdaService.updateEpda(id, dto, actorUserId);
  }

  /**
   * Finalize EPDA: persist snapshot and set status QUOTED for customer PDF access.
   * POST /api/v1/admin/inquiries/shipping-agency/:id/epda/issue
   */
  @Post('shipping-agency/:id/epda/issue')
  async issueShippingAgencyEpda(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: IssueShippingAgencyEpdaDto,
    @Req() req: StaffRequest,
  ) {
    const dto = await validateDto(IssueShippingAgencyEpdaDto, body);
    const actorUserId = req.user?.id;
    if (!actorUserId) {
      throw new BadRequestException('User not authenticated');
    }
    return this.shippingAgencyEpdaService.issueEpdaToCustomer(
      id,
      dto,
      actorUserId,
    );
  }

  /**
   * Lock EPDA edits: persist tariff snapshot and set epdaLockedAt.
   * POST /api/v1/admin/inquiries/shipping-agency/:id/epda/lock
   */
  @Post('shipping-agency/:id/epda/lock')
  async lockShippingAgencyEpda(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: LockShippingAgencyEpdaDto,
    @Req() req: StaffRequest,
  ) {
    const dto = await validateDto(LockShippingAgencyEpdaDto, body);
    const actorUserId = req.user?.id;
    if (!actorUserId) {
      throw new BadRequestException('User not authenticated');
    }
    return this.shippingAgencyEpdaService.lockEpda(id, dto, actorUserId);
  }

  @Get('shipping-agency/:id/epda/field-changes')
  listShippingAgencyFieldChanges(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListInquiryFieldChangesQueryDto,
  ) {
    return this.shippingAgencyEpdaService.listFieldChangeLogs(
      id,
      query.page ?? 0,
      query.size ?? 6,
    );
  }

  @Get('shipping-agency/:id/epda/customer-field-changes')
  listLatestCustomerFieldChanges(@Param('id', ParseIntPipe) id: number) {
    return this.shippingAgencyEpdaService.listLatestCustomerFieldChanges(id);
  }

  @Get(':serviceType/:id')
  getOne(
    @Param('serviceType') serviceType: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.inquiryService.getByServiceAndId(serviceType, id);
  }

  @Patch(':serviceType/:id/status')
  updateStatus(
    @Param('serviceType') serviceType: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInquiryStatusDto,
  ) {
    return this.inquiryService.updateStatus(serviceType, id, dto);
  }

  @Patch(':serviceType/:id/form')
  updateForm(
    @Param('serviceType') serviceType: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInquiryFormDto,
  ) {
    return this.inquiryService.updateForm(serviceType, id, dto);
  }

  @Patch(':serviceType/:id/hours')
  updateHours(
    @Param('serviceType') serviceType: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInquiryHoursDto,
  ) {
    return this.inquiryService.updateHours(serviceType, id, dto);
  }

  @Delete(':serviceType/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('serviceType') serviceType: string,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: StaffRequest,
  ) {
    const actorUserId = req.user?.id;
    if (!actorUserId) {
      throw new BadRequestException('User not authenticated');
    }

    return this.inquiryService.softDeleteBatch([id], actorUserId, serviceType);
  }

  @Delete(':serviceType/:id/permanent')
  @PermanentDelete({
    resourceType: 'inquiry',
    idSource: { kind: 'param', key: 'id' },
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  hardRemove(
    @Param('serviceType') serviceType: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.inquiryService.hardDeleteByServiceAndId(serviceType, id);
  }

  @Post(':serviceType/:id/restore')
  restoreOne(
    @Param('serviceType') serviceType: string,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: StaffRequest,
  ) {
    if (!isAdminRoleName(req.user?.role?.name)) {
      throw new ForbiddenException(
        'Only administrators can restore archived inquiries',
      );
    }
    return this.inquiryService.restoreByServiceAndId(serviceType, id);
  }
}
