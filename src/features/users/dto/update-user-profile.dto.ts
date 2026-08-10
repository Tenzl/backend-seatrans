import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Admin profile edit — login email/username stay unique;
 * companyEmail may duplicate and is never used for login.
 */
export class UpdateUserProfileDto {
  @IsEmail()
  @MaxLength(100)
  email!: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string | null;

  @ValidateIf((_, value) => value != null && String(value).trim() !== '')
  @IsEmail()
  @MaxLength(100)
  @IsOptional()
  companyEmail?: string | null;
}
