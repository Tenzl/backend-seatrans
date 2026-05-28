import { IsString, MinLength } from 'class-validator';

export class SessionExchangeDto {
  @IsString()
  @MinLength(16)
  token!: string;
}

