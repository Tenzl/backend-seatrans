import { IsBoolean, IsInt, IsNumberString, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreatePortDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  portOfCall?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  provinceId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  zoneCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsNumberString()
  longitude?: string;

  @IsOptional()
  @IsNumberString()
  latitude?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  hasInfo?: number;
}
