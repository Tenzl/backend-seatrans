import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiAdmin } from '../../shared/decorators/api-admin.decorator';
import { AdminSection } from '../../shared/decorators/admin-section.decorator';
import { SectionPermanentDelete } from '../../shared/decorators/permanent-delete.decorator';
import { CommodityGroupsService } from './commodity-groups.service';
import { AddCommodityToGroupDto } from './dto/add-commodity-to-group.dto';
import { CommodityGroupDto } from './dto/commodity-group.dto';
import { CommodityDto } from './dto/commodity.dto';
import { CreateCommodityGroupDto } from './dto/create-commodity-group.dto';
import { ListCommodityGroupsQueryDto } from './dto/list-commodity-groups-query.dto';
import { UpdateCommodityGroupDto } from './dto/update-commodity-group.dto';

@Controller('v1/admin/commodity-groups')
export class CommodityGroupsAdminController {
  constructor(private readonly groupsService: CommodityGroupsService) {}

  @AdminSection('data-commodities')
  @Get()
  list(
    @Query() query: ListCommodityGroupsQueryDto,
  ): Promise<CommodityGroupDto[]> {
    return this.groupsService.list(query);
  }

  @AdminSection('data-commodities')
  @Get(':id')
  getById(@Param('id') id: string): Promise<CommodityGroupDto> {
    return this.groupsService.getById(Number(id));
  }

  @ApiAdmin()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateCommodityGroupDto): Promise<CommodityGroupDto> {
    return this.groupsService.create(dto);
  }

  @ApiAdmin()
  @Post(':id/commodities')
  @HttpCode(HttpStatus.CREATED)
  addCommodity(
    @Param('id') id: string,
    @Body() dto: AddCommodityToGroupDto,
  ): Promise<CommodityDto> {
    return this.groupsService.addCommodity(Number(id), dto);
  }

  /** Rename group (`name`); 409 if duplicate within the same service. */
  @AdminSection('data-commodities')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCommodityGroupDto,
  ): Promise<CommodityGroupDto> {
    return this.groupsService.update(Number(id), dto);
  }

  @Delete(':id')
  @SectionPermanentDelete('data-commodities', {
    resourceType: 'commodity_group',
    idSource: { kind: 'param', key: 'id' },
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.groupsService.delete(Number(id));
  }
}
