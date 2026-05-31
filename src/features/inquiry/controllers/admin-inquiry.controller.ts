import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { ServiceInquiryService } from '../services/service-inquiry.service';
import { ShippingAgencyEpdaService } from '../services/shipping-agency-epda.service';
import { ListInquiriesQueryDto } from '../dto/list-inquiries-query.dto';
import { UpdateInquiryStatusDto } from '../dto/update-inquiry-status.dto';
import { UpdateInquiryFormDto } from '../dto/update-inquiry-form.dto';
import { UpdateInquiryHoursDto } from '../dto/update-inquiry-hours.dto';
import { DeleteInquiriesDto } from '../dto/delete-inquiries.dto';
import { UpdateShippingAgencyEpdaDto } from '../dto/update-shipping-agency-epda.dto';
import { IssueShippingAgencyEpdaDto } from '../dto/issue-shipping-agency-epda.dto';
import { CreateInternalShippingAgencyInquiryDto } from '../dto/create-internal-shipping-agency-inquiry.dto';
import { ListInquiryFieldChangesQueryDto } from '../dto/list-inquiry-field-changes-query.dto';
import { validateDto } from '../../../shared/utils/validate-dto.util';

/**
 * Admin inquiry API.
 * List/filter: GET /v1/admin/inquiries?serviceType=&status=&page=&size=
 * Detail: GET /v1/admin/inquiries/:serviceType/:id
 */
type StaffRequest = Request & { user?: { id?: number } };

@ApiAdmin()
@Controller('v1/admin/inquiries')
export class AdminInquiryController {
  constructor(
    private readonly inquiryService: ServiceInquiryService,
    private readonly shippingAgencyEpdaService: ShippingAgencyEpdaService,
  ) {}

  @Get()
  list(@Query() query: ListInquiriesQueryDto) {
    return this.inquiryService.listForAdmin(query);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteBatch(@Body() dto: DeleteInquiriesDto) {
    return this.inquiryService.deleteBatchByAdmin(dto.ids);
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
    return this.shippingAgencyEpdaService.createInternalInquiry(dto, actorUserId);
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
    return this.shippingAgencyEpdaService.issueEpdaToCustomer(id, dto, actorUserId);
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
  ) {
    return this.inquiryService.deleteByServiceAndId(serviceType, id);
  }
}
