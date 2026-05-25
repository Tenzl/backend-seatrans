import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateServiceTypeDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(200)
  displayName!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
