import { CustomerStatus } from '../enums/customer-status.enum';
import { CustomerType } from '../enums/customer-type.enum';
import { PartnerAdditionType } from '../enums/partner-addition-type.enum';

export type BookingPartnerListItemResponseDto = {
  id: number;
  customerId: string;
  name: string;
  additionTypes: PartnerAdditionType[];
  country: string | null;
  city: string | null;
  contactEmail: string | null;
  phone: string | null;
  fax: string | null;
  trackingUrl: string | null;
  address: string | null;
  customerStatus: CustomerStatus | null;
  customerType: CustomerType | null;
  taxNumber: string | null;
  createdBy: string;
  createdAt: Date;
  updatedBy: string;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type BookingPartnerDetailResponseDto = BookingPartnerListItemResponseDto;

import { PaginatedResponseDto } from '../../../shared/dto/pagination.dto';

export type BookingPartnerPageResponseDto =
  PaginatedResponseDto<BookingPartnerListItemResponseDto>;
