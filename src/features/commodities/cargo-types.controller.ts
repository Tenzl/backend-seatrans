import { Controller, Get, Param } from '@nestjs/common';
import { CargoTypesService } from './cargo-types.service';
import { CargoTypeDto } from './dto/cargo-type.dto';

@Controller('v1/cargo-types')
export class CargoTypesController {
  constructor(private readonly cargoTypesService: CargoTypesService) {}

  @Get('service-type/:serviceTypeId')
  getByServiceType(@Param('serviceTypeId') serviceTypeId: string): Promise<CargoTypeDto[]> {
    return this.cargoTypesService.getByServiceType(Number(serviceTypeId));
  }
}
