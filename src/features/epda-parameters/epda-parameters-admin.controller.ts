import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminSection } from '../../shared/decorators/admin-section.decorator';
import { EpdaParametersService } from './epda-parameters.service';
import {
  CreateEpdaParameterGroupDto,
  SetGroupMembersDto,
  UpdateEpdaParameterGroupDto,
  UpsertEpdaParameterSetDto,
} from './dto/upsert-epda-parameter-set.dto';

type StaffRequest = Request & { user?: { id?: number } };

@AdminSection('epda-parameter')
@Controller('v1/admin/epda-parameters')
export class EpdaParametersAdminController {
  constructor(private readonly service: EpdaParametersService) {}

  @Get()
  listAll() {
    return this.service.listAll();
  }

  /** Resolved values for the form (area overlaid with optional port override). */
  @Get('effective')
  getEffective(
    @Query('area') area: string,
    @Query('portId') portId?: string,
  ) {
    return this.service.getEffective(
      area,
      portId ? Number(portId) : undefined,
    );
  }

  /** Recent edit history; filter by `portId` (preferred) or `area`. */
  @Get('logs')
  listChangeLogs(
    @Query('area') area?: string,
    @Query('portId') portId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listChangeLogs({
      area: area || undefined,
      portId: portId ? Number(portId) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('area/:area')
  getArea(@Param('area') area: string) {
    return this.service.getAreaSet(area);
  }

  @Put('area/:area')
  upsertArea(
    @Param('area') area: string,
    @Body() dto: UpsertEpdaParameterSetDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.upsertArea(area, dto.values ?? {}, req.user?.id);
  }

  @Get('port/:portId')
  getPort(@Param('portId') portId: string) {
    return this.service.getPortOverride(Number(portId));
  }

  @Put('port/:portId')
  upsertPort(
    @Param('portId') portId: string,
    @Body() dto: UpsertEpdaParameterSetDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.upsertPort(Number(portId), dto.values ?? {}, req.user?.id);
  }

  @Delete('port/:portId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePort(
    @Param('portId') portId: string,
    @Req() req: StaffRequest,
  ): Promise<void> {
    await this.service.deletePort(Number(portId), req.user?.id);
  }

  // ---------- port groups ----------

  @Get('groups')
  listGroups(@Query('area') area: string) {
    return this.service.listGroups(area);
  }

  @Post('groups')
  createGroup(
    @Body() dto: CreateEpdaParameterGroupDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.createGroup(dto.area, dto.name, dto.values ?? {}, req.user?.id);
  }

  @Put('groups/:id')
  updateGroup(
    @Param('id') id: string,
    @Body() dto: UpdateEpdaParameterGroupDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.updateGroup(
      Number(id),
      { name: dto.name, values: dto.values },
      req.user?.id,
    );
  }

  @Put('groups/:id/members')
  setGroupMembers(
    @Param('id') id: string,
    @Body() dto: SetGroupMembersDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.setGroupMembers(Number(id), dto.portIds, req.user?.id);
  }

  @Delete('groups/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteGroup(
    @Param('id') id: string,
    @Req() req: StaffRequest,
  ): Promise<void> {
    await this.service.deleteGroup(Number(id), req.user?.id);
  }
}
