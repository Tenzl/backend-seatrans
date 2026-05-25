import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProvincesService } from './provinces.service';
import { ProvinceDto } from './dto/province.dto';
import { ProvinceListQueryDto } from './dto/province-list-query.dto';

/** Public read-only. Writes: /v1/admin/provinces */
@Controller('v1/provinces')
export class ProvincesController {
  constructor(private readonly provincesService: ProvincesService) {}

  @Get()
  getAllProvinces(@Query() query: ProvinceListQueryDto): Promise<ProvinceDto[]> {
    if (query.q?.trim()) {
      return this.provincesService.searchProvinces(query.q);
    }
    return this.provincesService.getAllProvinces(query.limit);
  }

  @Get('active')
  getActiveProvinces(@Query() query: ProvinceListQueryDto): Promise<ProvinceDto[]> {
    if (query.q?.trim()) {
      return this.provincesService.searchProvinces(query.q);
    }
    return this.provincesService.getActiveProvinces(query.limit);
  }

  @Get(':id')
  getProvinceById(@Param('id') id: string): Promise<ProvinceDto> {
    return this.provincesService.getProvinceById(Number(id));
  }
}
