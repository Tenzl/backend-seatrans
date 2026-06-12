import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiAdmin } from '../../shared/decorators/api-admin.decorator';
import { CargoTypesService } from './cargo-types.service';
import { CargoTypeDto } from './dto/cargo-type.dto';
import { CreateCargoTypeDto, UpdateCargoTypeDto } from './dto/upsert-cargo-type.dto';

@ApiAdmin()
@Controller('v1/admin/cargo-types')
export class CargoTypesAdminController {
  constructor(private readonly cargoTypesService: CargoTypesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateCargoTypeDto): Promise<CargoTypeDto> {
    return this.cargoTypesService.create(dto);
  }

  @Put(':serviceTypeId/:code')
  update(
    @Param('serviceTypeId') serviceTypeId: string,
    @Param('code') code: string,
    @Body() dto: UpdateCargoTypeDto,
  ): Promise<CargoTypeDto> {
    return this.cargoTypesService.update(Number(serviceTypeId), code, dto);
  }

  @Delete(':serviceTypeId/:code')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('serviceTypeId') serviceTypeId: string,
    @Param('code') code: string,
  ): Promise<void> {
    return this.cargoTypesService.delete(Number(serviceTypeId), code);
  }
}
