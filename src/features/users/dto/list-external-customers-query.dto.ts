import { IsOptional, IsString, MaxLength } from 'class-validator';
import { LimitQueryDto } from '../../../shared/dto/list-query.dto';

export class ListExternalCustomersQueryDto extends LimitQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
