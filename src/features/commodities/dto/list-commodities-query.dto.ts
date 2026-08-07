import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { LimitQueryDto } from '../../../shared/dto/list-query.dto';

/** Public/admin list filters: GET /commodities?serviceTypeId=&q=&limit= */
export class ListCommoditiesQueryDto extends LimitQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceTypeId?: number;
}
