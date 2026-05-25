import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiAdmin } from '../../../shared/decorators/api-admin.decorator';
import { ServiceInquiryService } from '../services/service-inquiry.service';
import { ListInquiriesQueryDto } from '../dto/list-inquiries-query.dto';
import { UpdateInquiryStatusDto } from '../dto/update-inquiry-status.dto';
import { UpdateInquiryFormDto } from '../dto/update-inquiry-form.dto';
import { UpdateInquiryHoursDto } from '../dto/update-inquiry-hours.dto';
import { DeleteInquiriesDto } from '../dto/delete-inquiries.dto';

/**
 * Admin inquiry API.
 * List/filter: GET /v1/admin/inquiries?serviceType=&status=&page=&size=
 * Detail: GET /v1/admin/inquiries/:serviceType/:id
 */
@ApiAdmin()
@Controller('v1/admin/inquiries')
export class AdminInquiryController {
  constructor(private readonly inquiryService: ServiceInquiryService) {}

  @Get()
  list(@Query() query: ListInquiriesQueryDto) {
    return this.inquiryService.listForAdmin(query);
  }

  @Delete('batch')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteBatch(@Body() dto: DeleteInquiriesDto) {
    return this.inquiryService.deleteBatchByAdmin(dto.ids);
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
