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

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsEnum(RoleGroup)
  roleGroup!: RoleGroup;

  /** Section keys this role may access (validated against the catalog in the service). */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  sections?: string[];
}
