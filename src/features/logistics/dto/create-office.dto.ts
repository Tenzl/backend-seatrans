import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateOfficeDto {
  @IsInt()
  @Min(1)
  provinceId!: number;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsString()
  address!: string;

  @IsString()
  @IsNotEmpty({ message: 'mapUrl is required' })
  @MaxLength(2048)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  mapUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  managerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  managerTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  managerMobile?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  managerEmail?: string;

  @IsOptional()
  @IsBoolean()
  isHeadquarter?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
