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
} from '@nestjs/common';
import { ApiAdmin } from '../../shared/decorators/api-admin.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { validateDto } from '../../shared/utils/validate-dto.util';
import { RolesAdminService } from './roles-admin.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

/**
 * Role + section-access management. ADMIN-only on purpose: granting sections is
 * a privileged operation, so it must not be reachable by a non-admin who merely
 * holds the "roles" section (prevents privilege escalation).
 */
@ApiAdmin()
@Roles('ROLE_ADMIN')
@Controller('v1/admin/roles')
export class RolesAdminController {
  constructor(private readonly service: RolesAdminService) {}

  @Get()
  list() {
    return this.service.listRoles();
  }

  /** Section catalog for the assignment UI. */
  @Get('sections/catalog')
  catalog() {
    return this.service.getCatalog();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateRoleDto) {
    const dto = await validateDto(CreateRoleDto, body);
    return this.service.createRole(dto);
  }

  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateRoleDto,
  ) {
    const dto = await validateDto(UpdateRoleDto, body);
    return this.service.updateRole(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteRole(id);
  }
}
