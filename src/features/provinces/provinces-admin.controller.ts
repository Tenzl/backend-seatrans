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
import { ProvincesService } from './provinces.service';
import { CreateProvinceDto } from './dto/create-province.dto';
import { ProvinceDto } from './dto/province.dto';

@ApiAdmin()
@Controller('v1/admin/provinces')
export class ProvincesAdminController {
  constructor(private readonly provincesService: ProvincesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createProvince(@Body() dto: CreateProvinceDto): Promise<ProvinceDto> {
    return this.provincesService.createProvince(dto);
  }

  @Put(':id')
  updateProvince(
    @Param('id') id: string,
    @Body() dto: CreateProvinceDto,
  ): Promise<ProvinceDto> {
    return this.provincesService.updateProvince(Number(id), dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProvince(@Param('id') id: string): Promise<void> {
    return this.provincesService.deleteProvince(Number(id));
  }
}
