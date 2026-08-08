import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RoleGroup } from '../../auth/enums/role-group.enum';
import { API_MAX_PAGE_SIZE } from '../../../shared/dto/list-query.dto';

export class AdminListUsersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsEnum(RoleGroup)
  roleGroup?: RoleGroup;

  /** Exact role name filter, e.g. ROLE_ADMIN */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  roleName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(API_MAX_PAGE_SIZE)
  limit?: number = 20;
}
