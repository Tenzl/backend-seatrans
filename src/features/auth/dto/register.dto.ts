import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Email must be valid' })
  @MaxLength(100, { message: 'Email must not exceed 100 characters' })
  email: string;

  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, { message: 'Password must contain uppercase, lowercase and number' })
  password: string;

  @IsNotEmpty({ message: 'Full name is required' })
  @MaxLength(100, { message: 'Full name must not exceed 100 characters' })
  fullName: string;

  @IsOptional()
  @Matches(/^[0-9+\-\s()]*$/, { message: 'Invalid phone format' })
  @MaxLength(20, { message: 'Phone must not exceed 20 characters' })
  phone?: string;

  @IsOptional()
  @MaxLength(255, { message: 'Company must not exceed 255 characters' })
  company?: string;
}
