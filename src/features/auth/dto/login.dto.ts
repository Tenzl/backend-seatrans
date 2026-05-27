import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsNotEmpty({ message: 'Email or username is required' })
  @IsString()
  @MaxLength(100)
  identifier: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString()
  password: string;
}
