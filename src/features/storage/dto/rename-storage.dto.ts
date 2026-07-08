import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RenameStorageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  fromKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  toKey!: string;
}
