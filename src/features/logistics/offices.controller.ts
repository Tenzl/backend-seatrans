import { Controller, Get, Query } from '@nestjs/common';
import { OfficesService } from './offices.service';

@Controller('v1/offices')
export class OfficesController {
  constructor(private readonly officesService: OfficesService) {}

  @Get('active')
  getActive(@Query('limit') limit?: string) {
    return this.officesService.getActive(limit ? Number(limit) : undefined);
  }
}
