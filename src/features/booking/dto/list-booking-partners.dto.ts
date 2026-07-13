import { Transform, Type, type TransformFnParams } from 'class-transformer';
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
  @Transform(({ value }: TransformFnParams) => {
    const rawValue = value as unknown;
    if (rawValue == null) {
      return undefined;
    }

    const values: unknown[] = Array.isArray(rawValue)
      ? (rawValue as unknown[])
      : [rawValue];
    return values
      .filter((item): item is string | number | boolean | bigint =>
        ['string', 'number', 'boolean', 'bigint'].includes(typeof item),
      )
      .flatMap((item) => String(item).split(','))
      .map((item) => item.trim().toUpperCase())
      .filter((item) => item.length > 0);
  })
  @IsEnum(PartnerAdditionType, { each: true })
  additionTypes?: PartnerAdditionType[];

  @IsOptional()
  @Transform(({ value }: TransformFnParams) => {
    const rawValue = value as unknown;
    return typeof rawValue === 'string'
      ? rawValue.trim().toUpperCase()
      : rawValue;
  })
  @IsIn(['OR', 'AND'])
  additionTypesMode?: 'OR' | 'AND' = 'OR';

  @IsOptional()
  @Transform(({ value }: TransformFnParams) => {
    const rawValue = value as unknown;
    if (typeof rawValue === 'boolean') {
      return rawValue;
    }
    return String(rawValue).toLowerCase() === 'true';
  })
  @IsBoolean()
  includeArchived?: boolean = false;
}
