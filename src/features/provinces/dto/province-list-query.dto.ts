import { IsOptional, IsString } from 'class-validator';
import { LimitQueryDto } from '../../../shared/dto/list-query.dto';

export class ProvinceListQueryDto extends LimitQueryDto {
  @IsOptional()
  @IsString()
  q?: string;
}
