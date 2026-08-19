import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiAdmin } from '../../shared/decorators/api-admin.decorator';
import { AdminSection } from '../../shared/decorators/admin-section.decorator';
import { SectionPermanentDelete } from '../../shared/decorators/permanent-delete.decorator';
import { CommodityTypesService } from './commodity-types.service';
import {
  CommodityTypeDto,
  CreateCommodityTypeDto,
  ListCommodityTypesQueryDto,
  UpdateCommodityTypeDto,
} from './dto/commodity-type.dto';

@Controller('v1/admin/commodity-types')
export class CommodityTypesAdminController {
  constructor(private readonly commodityTypesService: CommodityTypesService) {}

  @AdminSection('data-commodities')
  @Get()
  list(
    @Query() query: ListCommodityTypesQueryDto,
  ): Promise<CommodityTypeDto[]> {
    return this.commodityTypesService.list(query);
  }

  @ApiAdmin()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateCommodityTypeDto): Promise<CommodityTypeDto> {
    return this.commodityTypesService.create(dto);
  }

  @AdminSection('data-commodities')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCommodityTypeDto,
  ): Promise<CommodityTypeDto> {
    return this.commodityTypesService.update(Number(id), dto);
  }

  @Delete(':id')
  @SectionPermanentDelete('data-commodities', {
    resourceType: 'commodity_type',
    idSource: { kind: 'param', key: 'id' },
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id') id: string,
    @Query() query: ListCommodityTypesQueryDto,
  ): Promise<void> {
    return this.commodityTypesService.delete(Number(id), query.serviceTypeId);
  }
}
