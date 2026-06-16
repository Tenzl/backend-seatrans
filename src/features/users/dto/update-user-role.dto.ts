import { IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateUserRoleDto {
  @Type(() => Number)
  @IsInt()
  roleId!: number;
}
