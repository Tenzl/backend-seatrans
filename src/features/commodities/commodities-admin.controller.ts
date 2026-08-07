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
import { AdminSection } from '../../shared/decorators/admin-section.decorator';
import { PermanentDelete } from '../../shared/decorators/permanent-delete.decorator';
import { LimitQueryDto } from '../../shared/dto/list-query.dto';
import { CommoditiesService } from './commodities.service';
import { CommodityDto } from './dto/commodity.dto';
import { CreateCommodityDto } from './dto/create-commodity.dto';

@Controller('v1/admin/commodities')
export class CommoditiesAdminController {
  constructor(private readonly commoditiesService: CommoditiesService) {}

  @AdminSection('data-commodities')
  @Get()
  list(@Query() query: LimitQueryDto): Promise<CommodityDto[]> {
    return this.commoditiesService.list({ limit: query.limit });
  }

  @AdminSection('data-commodities')
  @Get(':id')
  getById(@Param('id') id: string): Promise<CommodityDto> {
    return this.commoditiesService.getById(Number(id));
  }

  /** Any internal staff may add commodities (matches legacy ROLE_EMPLOYEE access). */
  @ApiAdmin()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateCommodityDto): Promise<CommodityDto> {
    return this.commoditiesService.create(dto);
  }

  @AdminSection('data-commodities')
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: CreateCommodityDto,
  ): Promise<CommodityDto> {
    return this.commoditiesService.update(Number(id), dto);
  }

  @Delete(':id')
  @PermanentDelete({
    resourceType: 'commodity',
    idSource: { kind: 'param', key: 'id' },
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.commoditiesService.delete(Number(id));
  }
}
