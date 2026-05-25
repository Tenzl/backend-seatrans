import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiAdmin } from '../../shared/decorators/api-admin.decorator';
import { PortsService } from './ports.service';
import { CreatePortDto } from './dto/create-port.dto';
import { PortDto } from './dto/port.dto';
import { UpdatePortHasInfoDto } from './dto/update-port-has-info.dto';

@ApiAdmin()
@Controller('v1/admin/ports')
export class PortsAdminController {
  constructor(private readonly portsService: PortsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createPort(@Body() dto: CreatePortDto): Promise<PortDto> {
    return this.portsService.createPort(dto);
  }

  @Put(':id')
  updatePort(@Param('id') id: string, @Body() dto: CreatePortDto): Promise<PortDto> {
    return this.portsService.updatePort(Number(id), dto);
  }

  @Patch(':id/has-info')
  updateHasInfo(
    @Param('id') id: string,
    @Body() dto: UpdatePortHasInfoDto,
  ): Promise<PortDto> {
    return this.portsService.updateHasInfo(Number(id), dto.hasInfo);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePort(@Param('id') id: string): Promise<void> {
    return this.portsService.deletePort(Number(id));
  }
}
