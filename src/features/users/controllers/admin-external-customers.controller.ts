import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiAdmin } from '../../../shared/decorators/api-admin.decorator';
import { validateDto } from '../../../shared/utils/validate-dto.util';
import { ExternalCustomersService } from '../external-customers.service';
import { ListExternalCustomersQueryDto } from '../dto/list-external-customers-query.dto';
import { CreateExternalCustomerDto } from '../dto/create-external-customer.dto';

type StaffRequest = Request & { user?: { id?: number } };

@ApiAdmin()
@Controller('v1/admin/users/external-customers')
export class AdminExternalCustomersController {
  constructor(private readonly externalCustomersService: ExternalCustomersService) {}

  @Get()
  list(@Query() query: ListExternalCustomersQueryDto) {
    return this.externalCustomersService.listOptions(query.q, query.limit);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateExternalCustomerDto, @Req() req: StaffRequest) {
    const dto = await validateDto(CreateExternalCustomerDto, body);
    const staffUserId = req.user?.id;
    if (!staffUserId) {
      throw new BadRequestException('User not authenticated');
    }
    return this.externalCustomersService.createForStaff(dto, staffUserId);
  }
}
