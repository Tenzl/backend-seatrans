import { Controller, Get, Param, Query } from '@nestjs/common';
import { PortsService } from './ports.service';
import { PortDto } from './dto/port.dto';
import { ListPortsQueryDto } from './dto/list-ports-query.dto';
import { ListPortOptionsQueryDto } from './dto/list-port-options-query.dto';

/** Public read-only. Writes: /v1/admin/ports */
@Controller('v1/ports')
export class PortsController {
  constructor(private readonly portsService: PortsService) {}

  @Get()
  listPorts(@Query() query: ListPortsQueryDto) {
    return this.portsService.listPortsPage(query);
  }

  @Get('active')
  getActivePorts(@Query() query: ListPortsQueryDto) {
    return this.portsService.listPortsPage({ ...query, active: true });
  }

  @Get('province/:provinceId')
  getPortsByProvince(
    @Param('provinceId') provinceId: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<PortDto[]> {
    if (q?.trim()) {
      return this.portsService.searchPortsByProvince(Number(provinceId), q);
    }
    return this.portsService.getPortsByProvince(
      Number(provinceId),
      limit ? Number(limit) : undefined,
    );
  }

  @Get('options')
  listPortOptions(@Query() query: ListPortOptionsQueryDto) {
    return this.portsService.listPortOptions({
      q: query.q,
      ids: query.ids,
      limit: query.limit,
    });
  }

  @Get(':id')
  getPortById(@Param('id') id: string): Promise<PortDto> {
    return this.portsService.getPortById(Number(id));
  }
}
