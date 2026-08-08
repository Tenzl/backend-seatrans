import { IsInt, IsObject, IsOptional, Min } from 'class-validator';
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
  /**
   * Freight-forwarding commodity id from booking picker. When set, payload
   * validation resolves `commodity` to `{name} IN {group}` displayLabel.
   */
  @IsOptional() @IsInt() @Min(1) commodityId?: number;
  @PreviewText(1_000) commodity?: string;
  /** Derived multiline display string for PDF / AN-DO prefill. */
  @PreviewText(500) volume?: string;
  /**
   * Structured cargo volumes (only qty > 0 after normalization).
   * Example: { "20'DC": 3, "40'RF": 1 }
   */
  @IsOptional()
  @IsObject()
  cargoVolumes?: Record<string, number>;
  @PreviewText(300) grossWeight?: string;
  @PreviewText(300) measurement?: string;
  @PreviewText(300) transitPort?: string;
  @PreviewText(2_000) specialRemark?: string;
  @PreviewText(300) motherVessel?: string;
  @PreviewText(300) motherVoyage?: string;
  /** Selected internal PIC user as `fullName, Email: email` (fallback: creator). */
  @PreviewText(500) pic?: string;
}
