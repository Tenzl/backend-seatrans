import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { RoleGroup } from '../../auth/enums/role-group.enum';
import { GRANTABLE_SECTION_KEYS } from '../section-catalog';

export class CreateRoleDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'name must use letters, numbers and underscores only',
  })
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
  @ArrayMaxSize(GRANTABLE_SECTION_KEYS.length)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  @IsIn([...GRANTABLE_SECTION_KEYS], { each: true })
  sections?: string[];
}
