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
  @IsOptional() @IsInt() @Min(1) placeOfReceiptPortId?: number | null;
  @PreviewText(300) portOfLoading?: string;
  @IsOptional() @IsInt() @Min(1) portOfLoadingPortId?: number | null;
  /** Independent B/L issuing place; never infer from the cargo route. */
  @PreviewText(300) placeOfIssue?: string;
  @IsOptional() @IsInt() @Min(1) placeOfIssuePortId?: number | null;
  @PreviewText(100) pickupDate?: string;
  @PreviewText(300) pickupPlace?: string;
  @IsOptional() @IsInt() @Min(1) pickupPlacePortId?: number | null;
  @PreviewText(300) portOfDischarge?: string;
  @IsOptional() @IsInt() @Min(1) portOfDischargePortId?: number | null;
  @PreviewText(300) placeOfDelivery?: string;
  @IsOptional() @IsInt() @Min(1) placeOfDeliveryPortId?: number | null;
  @PreviewText(300) dropoffPlace?: string;
  @IsOptional() @IsInt() @Min(1) dropoffPlacePortId?: number | null;
  @PreviewText(100) closingTime?: string;
  @PreviewText(100) siCutoff?: string;
  @PreviewText(100) vgmCutoff?: string;
  @PreviewText(500) contact?: string;
  /** Independent Freight Forwarding catalog identities. */
  @IsOptional() @IsInt() @Min(1) commodityTypeId?: number | null;
  @IsOptional() @IsInt() @Min(1) commodityId?: number | null;
  /** Stable catalog snapshots; never refresh these on historical reads. */
  @PreviewText(300) commodityType?: string;
  @PreviewText(300) commodityName?: string;
  /** Stable rendered description: `{Commodity} IN {Type}` when both exist. */
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
  @IsOptional() @IsInt() @Min(1) transitPortId?: number | null;
  @PreviewText(2_000) specialRemark?: string;
  @PreviewText(300) motherVessel?: string;
  @PreviewText(300) motherVoyage?: string;
  /** Selected internal PIC user as `fullName, Email: email` (fallback: creator). */
  @IsOptional() @IsInt() @Min(1) picUserId?: number;
  @PreviewText(500) pic?: string;
}
