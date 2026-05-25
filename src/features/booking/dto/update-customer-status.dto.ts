import { IsEnum } from 'class-validator';
import { CustomerStatus } from '../enums/customer-status.enum';

export class UpdateCustomerStatusDto {
  @IsEnum(CustomerStatus)
  customerStatus!: CustomerStatus;
}
