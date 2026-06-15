import { ApproveStatus } from '../enums/approve-status.enum';
import { CustomerStatus } from '../enums/customer-status.enum';
import { CustomerType } from '../enums/customer-type.enum';
import { PartnerAdditionType } from '../enums/partner-addition-type.enum';
import { PartnerContact } from '../types/partner-contact';

export type BookingPartnerListItemResponseDto = {
  id: number;
  customerId: string;
  name: string;
  additionTypes: PartnerAdditionType[];
  country: string | null;
  city: string | null;
  contacts: PartnerContact[];
  phone: string | null;
  fax: string | null;
  trackingUrl: string | null;
  address: string | null;
  customerStatus: CustomerStatus | null;
  customerType: CustomerType | null;
  approveStatus: ApproveStatus | null;
  approveBy: string | null;
  companyEstablishmentDate: string | null;
  paymentDueDays: number | null;
  contractNo: string | null;
  taxNumber: string | null;
  invoiceCompanyName: string | null;
  invoiceCompanyAddress: string | null;
  invoiceCompanyPhone: string | null;
  invoiceCompanyEmail: string | null;
  invoiceBankName: string | null;
  invoiceBankBranch: string | null;
  invoiceBankAccount: string | null;
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
