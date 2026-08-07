import { Controller, Get, Query } from '@nestjs/common';
import { CommoditiesService } from './commodities.service';
import { CommodityDto } from './dto/commodity.dto';
import { ListCommoditiesQueryDto } from './dto/list-commodities-query.dto';

@Controller('v1/commodities')
export class CommoditiesController {
  constructor(private readonly commoditiesService: CommoditiesService) {}

  /**
   * List commodities.
   * Filters (api-design): ?serviceTypeId=&q=&limit=
   */
  @Get()
  list(@Query() query: ListCommoditiesQueryDto): Promise<CommodityDto[]> {
    return this.commoditiesService.list(query);
  }
}
