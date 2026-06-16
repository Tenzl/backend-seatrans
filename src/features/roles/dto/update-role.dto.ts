import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { RoleGroup } from '../../auth/enums/role-group.enum';

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsEnum(RoleGroup)
  roleGroup?: RoleGroup;

  /** When provided, replaces the role's section set wholesale. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  sections?: string[];
}
