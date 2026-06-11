import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiAdmin } from '../../../shared/decorators/api-admin.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { validateDto } from '../../../shared/utils/validate-dto.util';
import { AdminUsersService } from '../admin-users.service';
import { AdminListUsersQueryDto } from '../dto/admin-list-users-query.dto';
import { CreateInternalUserDto } from '../dto/create-internal-user.dto';
import { ResetUserPasswordDto } from '../dto/reset-user-password.dto';
import { RoleGroup } from '../../auth/enums/role-group.enum';

type StaffRequest = Request & { user?: { id?: number } };

@ApiAdmin()
@Roles('ROLE_ADMIN')
@Controller('v1/admin/users')
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  list(@Query() query: AdminListUsersQueryDto) {
    return this.adminUsersService.listUsers({
      q: query.q,
      roleGroup: query.roleGroup,
      roleName: query.roleName,
      limit: query.limit,
    });
  }

  @Get('roles')
  roles(@Query('roleGroup') roleGroup?: RoleGroup) {
    return this.adminUsersService.listRoles(roleGroup);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateInternalUserDto, @Req() req: StaffRequest) {
    const dto = await validateDto(CreateInternalUserDto, body);
    const staffUserId = req.user?.id;
    if (!staffUserId) {
      throw new BadRequestException('User not authenticated');
    }
    return this.adminUsersService.createInternalUser(dto, staffUserId);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ResetUserPasswordDto,
  ) {
    const dto = await validateDto(ResetUserPasswordDto, body);
    return this.adminUsersService.resetPassword(id, dto.newPassword);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: StaffRequest) {
    const staffUserId = req.user?.id;
    if (!staffUserId) {
      throw new BadRequestException('User not authenticated');
    }
    return this.adminUsersService.deleteUser(id, staffUserId);
  }
}

