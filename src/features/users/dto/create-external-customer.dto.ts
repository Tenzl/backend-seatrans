import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateExternalCustomerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName!: string;
}
