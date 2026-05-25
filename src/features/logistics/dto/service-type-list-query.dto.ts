import { IsOptional, IsString } from 'class-validator';
import { LimitQueryDto } from '../../../shared/dto/list-query.dto';

export class ServiceTypeListQueryDto extends LimitQueryDto {
  @IsOptional()
  @IsString()
  q?: string;
}
