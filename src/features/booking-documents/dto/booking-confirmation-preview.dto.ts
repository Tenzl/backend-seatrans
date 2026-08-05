import { IsInt, IsOptional, Min } from 'class-validator';
import { PreviewText } from './preview-text.decorator';

export class BookingConfirmationPreviewDto {
  @PreviewText(100) date?: string;
  @PreviewText(200) bookingNumber?: string;
  @PreviewText(2_000) to?: string;
  @IsOptional() @IsInt() @Min(1) clientPartyId?: number;
  @PreviewText(300) vesselVoyage?: string;
  @PreviewText(100) etd?: string;
  @PreviewText(100) eta?: string;
  @PreviewText(300) placeOfReceipt?: string;
  @PreviewText(300) portOfLoading?: string;
  @PreviewText(100) pickupDate?: string;
  @PreviewText(300) pickupPlace?: string;
  @PreviewText(300) portOfDischarge?: string;
  @PreviewText(300) placeOfDelivery?: string;
  @PreviewText(300) dropoffPlace?: string;
  @PreviewText(100) closingTime?: string;
  @PreviewText(100) siCutoff?: string;
  @PreviewText(100) vgmCutoff?: string;
  @PreviewText(500) contact?: string;
  @PreviewText(1_000) commodity?: string;
  @PreviewText(300) volume?: string;
  @PreviewText(300) grossWeight?: string;
  @PreviewText(300) measurement?: string;
  @PreviewText(300) transitPort?: string;
  @PreviewText(2_000) specialRemark?: string;
  @PreviewText(300) motherVessel?: string;
  @PreviewText(300) motherVoyage?: string;
  @PreviewText(500) pic?: string;
}
