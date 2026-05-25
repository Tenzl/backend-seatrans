import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OfficesService } from './offices.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateOfficeDto } from './dto/create-office.dto';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ROLE_ADMIN', 'ROLE_EMPLOYEE', 'ROLE_INTERNAL')
@Controller('v1/admin/offices')
export class OfficesAdminController {
  constructor(private readonly officesService: OfficesService) {}

  @Get()
  getAll(@Query('limit') limit?: string) {
    return this.officesService.getAll(limit ? Number(limit) : undefined);
  }

  @Post()
  create(@Body() dto: CreateOfficeDto) {
    return this.officesService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: CreateOfficeDto) {
    return this.officesService.update(Number(id), dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.officesService.delete(Number(id));
  }
}
