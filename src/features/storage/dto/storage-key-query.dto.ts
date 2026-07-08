import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class StorageKeyQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  key!: string;
}
