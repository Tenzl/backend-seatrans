import { Controller, Get, Param, Query } from '@nestjs/common';
import { LimitQueryDto } from '../../shared/dto/list-query.dto';
import { CommoditiesService } from './commodities.service';
import { CommodityDto } from './dto/commodity.dto';

@Controller('v1/commodities')
export class CommoditiesController {
  constructor(private readonly commoditiesService: CommoditiesService) {}

  @Get('active')
  getActive(@Query() query: LimitQueryDto & { q?: string }): Promise<CommodityDto[]> {
    if (query.q?.trim()) {
      return this.commoditiesService.search(query.q);
    }
    return this.commoditiesService.getActive(query.limit);
  }

  @Get('service-type/:serviceTypeId')
  getByServiceType(
    @Param('serviceTypeId') serviceTypeId: string,
    @Query() query: LimitQueryDto & { q?: string },
  ): Promise<CommodityDto[]> {
    if (query.q?.trim()) {
      return this.commoditiesService.searchByServiceType(
        Number(serviceTypeId),
        query.q,
      );
    }
    return this.commoditiesService.getByServiceType(
      Number(serviceTypeId),
      query.limit,
    );
  }
}
