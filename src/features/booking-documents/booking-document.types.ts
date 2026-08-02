import { ArrivalNoticePreviewDto } from './dto/arrival-notice-preview.dto';
import { BillOfLadingPreviewDto } from './dto/bill-of-lading-preview.dto';
import { BookingConfirmationPreviewDto } from './dto/booking-confirmation-preview.dto';
import { DeliveryOrderPreviewDto } from './dto/delivery-order-preview.dto';

export type BookingDocumentPayload =
  | ArrivalNoticePreviewDto
  | BookingConfirmationPreviewDto
  | DeliveryOrderPreviewDto
  | BillOfLadingPreviewDto;

export interface BookingDocumentPreview {
  data: Buffer;
  filename: string;
}
