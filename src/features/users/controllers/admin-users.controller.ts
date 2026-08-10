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
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminSection } from '../../../shared/decorators/admin-section.decorator';
import { ApiAdminOnly } from '../../../shared/decorators/api-admin.decorator';
import { validateDto } from '../../../shared/utils/validate-dto.util';
import { BOOKING_DOCUMENT_SECTION } from '../../booking-documents/constants/booking-document.constants';
import { AdminUsersService } from '../admin-users.service';
import { AdminListUsersQueryDto } from '../dto/admin-list-users-query.dto';
import { AdminPicOptionsQueryDto } from '../dto/admin-pic-options-query.dto';
import { CreateInternalUserDto } from '../dto/create-internal-user.dto';
import { ResetUserPasswordDto } from '../dto/reset-user-password.dto';
import { UpdateUserProfileDto } from '../dto/update-user-profile.dto';
import { UpdateUserRoleDto } from '../dto/update-user-role.dto';
import { RoleGroup } from '../../auth/enums/role-group.enum';

type StaffRequest = Request & { user?: { id?: number } };

@Controller('v1/admin/users')
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  /**
   * Booking Person In Charge options. Available to staff with booking-documents
   * section access (not ROLE_ADMIN-only), and never returns password hashes.
   */
  @Get('pic-options')
  @AdminSection(BOOKING_DOCUMENT_SECTION)
  listPicOptions(@Query() query: AdminPicOptionsQueryDto) {
    return this.adminUsersService.listPicOptions({
      q: query.q,
      limit: query.limit,
    });
  }

  @Get()
  @ApiAdminOnly()
  list(@Query() query: AdminListUsersQueryDto) {
    return this.adminUsersService.listUsers({
      q: query.q,
      roleGroup: query.roleGroup,
      roleName: query.roleName,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('roles')
  @ApiAdminOnly()
  roles(@Query('roleGroup') roleGroup?: RoleGroup) {
    return this.adminUsersService.listRoles(roleGroup);
  }

  @Post()
  @ApiAdminOnly()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateInternalUserDto, @Req() req: StaffRequest) {
    const dto = await validateDto(CreateInternalUserDto, body);
    const staffUserId = req.user?.id;
    if (!staffUserId) {
      throw new BadRequestException('User not authenticated');
    }
    return this.adminUsersService.createInternalUser(dto, staffUserId);
  }

  @Patch(':id/role')
  @ApiAdminOnly()
  @HttpCode(HttpStatus.OK)
  async updateRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateUserRoleDto,
    @Req() req: StaffRequest,
  ) {
    const dto = await validateDto(UpdateUserRoleDto, body);
    const staffUserId = req.user?.id;
    if (!staffUserId) {
      throw new BadRequestException('User not authenticated');
    }
    return this.adminUsersService.updateUserRole(id, dto.roleId, staffUserId);
  }

  @Patch(':id/profile')
  @ApiAdminOnly()
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateUserProfileDto,
  ) {
    const dto = await validateDto(UpdateUserProfileDto, body);
    return this.adminUsersService.updateProfile(id, dto);
  }

  @Post(':id/reset-password')
  @ApiAdminOnly()
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ResetUserPasswordDto,
  ) {
    const dto = await validateDto(ResetUserPasswordDto, body);
    return this.adminUsersService.resetPassword(id, dto.newPassword);
  }

  @Delete(':id')
  @ApiAdminOnly()
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: StaffRequest,
  ) {
    const staffUserId = req.user?.id;
    if (!staffUserId) {
      throw new BadRequestException('User not authenticated');
    }
    return this.adminUsersService.deleteUser(id, staffUserId);
  }

  @Post(':id/reactivate')
  @ApiAdminOnly()
  @HttpCode(HttpStatus.OK)
  async reactivate(@Param('id', ParseIntPipe) id: number) {
    return this.adminUsersService.reactivateUser(id);
  }
}
