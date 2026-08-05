import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CustomerType } from '../enums/customer-type.enum';
import { PartnerAdditionType } from '../enums/partner-addition-type.enum';

export class ListPartnerOptionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number = 0;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number = 10;

  @IsOptional()
  @IsEnum(PartnerAdditionType)
  additionType?: PartnerAdditionType;

  @IsOptional()
  @IsEnum(CustomerType)
  customerType?: CustomerType;
}
