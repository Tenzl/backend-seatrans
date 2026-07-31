import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { Roles } from '../../features/auth/decorators/roles.decorator';
import { RolesGuard } from '../../features/auth/guards/roles.guard';
import { RoleGroup } from '../../features/auth/enums/role-group.enum';
import { Section } from '../../features/roles/decorators/section.decorator';
import { SectionAccessGuard } from '../../features/roles/guards/section-access.guard';
import { PermanentDelete } from '../../shared/decorators/permanent-delete.decorator';
import { EpdaParametersService } from './epda-parameters.service';
import {
  CreateEpdaParameterGroupDto,
  SetGroupMembersDto,
  UpdateEpdaParameterGroupDto,
  UpsertEpdaParameterSetDto,
} from './dto/upsert-epda-parameter-set.dto';

type StaffRequest = Request & { user?: { id?: number } };
const REQUIRED_INTEGER = new ParseIntPipe();
const OPTIONAL_INTEGER = new ParseIntPipe({ optional: true });

/**
 * EPDA parameter APIs.
 * - Reads used by Create/Edit EPDA (`effective`, area/port GET): any INTERNAL staff.
 * - Writes / Parameter screen: require `epda-parameter` section.
 */
@Controller('v1/admin/epda-parameters')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(RoleGroup.INTERNAL)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class EpdaParametersAdminController {
  constructor(private readonly service: EpdaParametersService) {}

  @Get()
  @UseGuards(SectionAccessGuard)
  @Section('epda-parameter')
  listAll() {
    return this.service.listAll();
  }

  /** Live area+port tariff merge for Create/Edit EPDA. */
  @Get('effective')
  getEffective(
    @Query('area') area?: string,
    @Query('portId', OPTIONAL_INTEGER) portId?: number,
  ) {
    return this.service.getEffective(area, portId);
  }

  @Get('logs')
  @UseGuards(SectionAccessGuard)
  @Section('epda-parameter')
  listChangeLogs(
    @Query('area') area?: string,
    @Query('portId', OPTIONAL_INTEGER) portId?: number,
    @Query('limit', OPTIONAL_INTEGER) limit?: number,
  ) {
    return this.service.listChangeLogs({
      area: area || undefined,
      portId,
      limit,
    });
  }

  @Get('area/:area')
  getArea(@Param('area') area: string) {
    return this.service.getAreaSet(area);
  }

  @Put('area/:area')
  @UseGuards(SectionAccessGuard)
  @Section('epda-parameter')
  upsertArea(
    @Param('area') area: string,
    @Body() dto: UpsertEpdaParameterSetDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.upsertArea(
      area,
      dto.values ?? {},
      req.user?.id,
      dto.expectedVersion,
    );
  }

  @Get('port/:portId')
  getPort(@Param('portId', REQUIRED_INTEGER) portId: number) {
    return this.service.getPortOverride(portId);
  }

  @Put('port/:portId')
  @UseGuards(SectionAccessGuard)
  @Section('epda-parameter')
  upsertPort(
    @Param('portId', REQUIRED_INTEGER) portId: number,
    @Body() dto: UpsertEpdaParameterSetDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.upsertPort(
      portId,
      dto.values ?? {},
      req.user?.id,
      dto.expectedVersion,
    );
  }

  @Delete('port/:portId')
  @PermanentDelete({
    resourceType: 'epda_port_override',
    idSource: { kind: 'param', key: 'portId' },
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SectionAccessGuard)
  @Section('epda-parameter')
  async deletePort(
    @Param('portId', REQUIRED_INTEGER) portId: number,
    @Query('expectedVersion', OPTIONAL_INTEGER)
    expectedVersion: number | undefined,
    @Req() req: StaffRequest,
  ): Promise<void> {
    await this.service.deletePort(portId, req.user?.id, expectedVersion);
  }

  @Get('groups')
  @UseGuards(SectionAccessGuard)
  @Section('epda-parameter')
  listGroups(@Query('area') area: string) {
    return this.service.listGroups(area);
  }

  @Post('groups')
  @UseGuards(SectionAccessGuard)
  @Section('epda-parameter')
  createGroup(
    @Body() dto: CreateEpdaParameterGroupDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.createGroup(
      dto.area,
      dto.name,
      dto.values ?? {},
      req.user?.id,
    );
  }

  @Put('groups/:id')
  @UseGuards(SectionAccessGuard)
  @Section('epda-parameter')
  updateGroup(
    @Param('id', REQUIRED_INTEGER) id: number,
    @Body() dto: UpdateEpdaParameterGroupDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.updateGroup(
      id,
      { name: dto.name, values: dto.values },
      req.user?.id,
      dto.expectedVersion,
    );
  }

  @Put('groups/:id/members')
  @UseGuards(SectionAccessGuard)
  @Section('epda-parameter')
  setGroupMembers(
    @Param('id', REQUIRED_INTEGER) id: number,
    @Body() dto: SetGroupMembersDto,
    @Req() req: StaffRequest,
  ) {
    return this.service.setGroupMembers(
      id,
      dto.portIds,
      req.user?.id,
      dto.expectedVersion,
    );
  }

  @Delete('groups/:id')
  @PermanentDelete({
    resourceType: 'epda_parameter_group',
    idSource: { kind: 'param', key: 'id' },
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SectionAccessGuard)
  @Section('epda-parameter')
  async deleteGroup(
    @Param('id', REQUIRED_INTEGER) id: number,
    @Query('expectedVersion', OPTIONAL_INTEGER)
    expectedVersion: number | undefined,
    @Req() req: StaffRequest,
  ): Promise<void> {
    await this.service.deleteGroup(id, req.user?.id, expectedVersion);
  }
}
