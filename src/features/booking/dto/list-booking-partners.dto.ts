import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { CustomerStatus } from '../enums/customer-status.enum';
import { CustomerType } from '../enums/customer-type.enum';
import { PartnerAdditionType } from '../enums/partner-addition-type.enum';

export class ListBookingPartnersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number = 20;

  @IsOptional()
  @IsString()
  sort?: string = 'updatedAt,desc';

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(CustomerStatus)
  customerStatus?: CustomerStatus;

  @IsOptional()
  @IsEnum(CustomerType)
  customerType?: CustomerType;

  @IsOptional()
  @Transform(({ value }) => {
    if (value == null) {
      return undefined;
    }

    const values = Array.isArray(value) ? value : [value];
    return values
      .flatMap((item) => String(item).split(','))
      .map((item) => item.trim().toUpperCase())
      .filter((item) => item.length > 0);
  })
  @IsEnum(PartnerAdditionType, { each: true })
  additionTypes?: PartnerAdditionType[];

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(['OR', 'AND'])
  additionTypesMode?: 'OR' | 'AND' = 'OR';

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') {
      return value;
    }
    return String(value).toLowerCase() === 'true';
  })
  @IsBoolean()
  includeArchived?: boolean = false;
}
