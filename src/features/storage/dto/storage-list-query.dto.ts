import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StorageListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  prefix?: string;
}
