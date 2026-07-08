import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateFolderDto {
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  prefix?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;
}
