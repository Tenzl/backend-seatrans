import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiAdmin } from '../../shared/decorators/api-admin.decorator';
import { LimitQueryDto } from '../../shared/dto/list-query.dto';
import { ServiceTypesService } from './service-types.service';
import { CreateServiceTypeDto } from './dto/create-service-type.dto';
import { ServiceTypeListQueryDto } from './dto/service-type-list-query.dto';

@Controller('v1/service-types')
export class ServiceTypesController {
  constructor(private readonly serviceTypesService: ServiceTypesService) {}

  @Get()
  getAll(@Query() query: ServiceTypeListQueryDto) {
    if (query.q?.trim()) {
      return this.serviceTypesService.search(query.q);
    }
    return this.serviceTypesService.getAll(query.limit);
  }

  @Get('active')
  getActive(@Query() query: LimitQueryDto) {
    return this.serviceTypesService.getActive(query.limit);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.serviceTypesService.getById(Number(id));
  }

  @ApiAdmin()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateServiceTypeDto) {
    return this.serviceTypesService.create(dto);
  }

  @ApiAdmin()
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: CreateServiceTypeDto) {
    return this.serviceTypesService.update(Number(id), dto);
  }

  @ApiAdmin()
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.serviceTypesService.delete(Number(id));
  }
}
