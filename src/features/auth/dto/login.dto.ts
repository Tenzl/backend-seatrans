import {
  IsNotEmpty,
  IsString,
  MaxLength,
  IsOptional,
  IsBoolean,
} from 'class-validator';

export class LoginDto {
  @IsNotEmpty({ message: 'Email or username is required' })
  @IsString()
  @MaxLength(100)
  identifier: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString()
  password: string;

  /** Longer absolute session for EXTERNAL users when true. */
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}
