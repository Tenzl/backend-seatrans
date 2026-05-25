import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateInquiryFormDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  form!: string;
}
