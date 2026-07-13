import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { OfficesService } from './offices.service';
import { CreateOfficeDto } from './dto/create-office.dto';
import { AdminSection } from '../../shared/decorators/admin-section.decorator';

@AdminSection('data-offices')
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
