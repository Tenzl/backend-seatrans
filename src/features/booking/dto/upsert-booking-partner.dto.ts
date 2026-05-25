import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { CustomerStatus } from '../enums/customer-status.enum';
import { CustomerType } from '../enums/customer-type.enum';
import { PartnerAdditionType } from '../enums/partner-addition-type.enum';

export class UpsertBookingPartnerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsArray()
  @IsNotEmpty()
  @IsEnum(PartnerAdditionType, { each: true })
  additionTypes!: PartnerAdditionType[];

  @IsOptional()
  @IsString()
  @MaxLength(128)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  fax?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  trackingUrl?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsEnum(CustomerStatus)
  customerStatus?: CustomerStatus;

  @IsOptional()
  @IsEnum(CustomerType)
  customerType?: CustomerType;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  taxNumber?: string;
}
