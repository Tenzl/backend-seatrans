import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ConfirmedCustomerFieldChangeDto {
  @IsString()
  @MaxLength(64)
  field!: string;

  @IsOptional()
  @IsString()
  previousValue?: string;

  @IsOptional()
  @IsString()
  newValue?: string;
}
