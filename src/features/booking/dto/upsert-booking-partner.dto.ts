import {
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApproveStatus } from '../enums/approve-status.enum';
import { CustomerStatus } from '../enums/customer-status.enum';
import { CustomerType } from '../enums/customer-type.enum';
import { PartnerAdditionType } from '../enums/partner-addition-type.enum';

/** One contact person within a partner's `contacts` array. */
export class PartnerContactDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  person?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  title?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;
}

export class UpsertBookingPartnerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  /**
   * Optional on create: when supplied (e.g. migrating from a legacy system) the
   * value is preserved; when blank the backend auto-generates a customer id.
   * Ignored on update (customer id is immutable).
   */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  customerId?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(PartnerAdditionType, { each: true })
  additionTypes?: PartnerAdditionType[];

  @IsOptional()
  @IsString()
  @MaxLength(128)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  city?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PartnerContactDto)
  contacts?: PartnerContactDto[];

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
  @IsEnum(ApproveStatus)
  approveStatus?: ApproveStatus;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  approveBy?: string;

  @IsOptional()
  @IsDateString()
  companyEstablishmentDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  paymentDueDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  contractNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  taxNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  invoiceCompanyName?: string;

  @IsOptional()
  @IsString()
  invoiceCompanyAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  invoiceCompanyPhone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  invoiceCompanyEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  invoiceBankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  invoiceBankBranch?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  invoiceBankAccount?: string;
}
