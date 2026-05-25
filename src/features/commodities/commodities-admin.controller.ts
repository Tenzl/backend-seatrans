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
import { CommoditiesService } from './commodities.service';
import { CommodityDto } from './dto/commodity.dto';
import { CreateCommodityDto } from './dto/create-commodity.dto';

@ApiAdmin()
@Controller('v1/admin/commodities')
export class CommoditiesAdminController {
  constructor(private readonly commoditiesService: CommoditiesService) {}

  @Get()
  getAll(@Query() query: LimitQueryDto): Promise<CommodityDto[]> {
    return this.commoditiesService.getAllAdmin(query.limit);
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<CommodityDto> {
    return this.commoditiesService.getById(Number(id));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateCommodityDto): Promise<CommodityDto> {
    return this.commoditiesService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: CreateCommodityDto): Promise<CommodityDto> {
    return this.commoditiesService.update(Number(id), dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.commoditiesService.delete(Number(id));
  }
}
