import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { AnContainerDto } from './an-container.dto';
import { CargoRowDto } from './cargo-row.dto';
import { PreviewText } from './preview-text.decorator';

export class DeliveryOrderPreviewDto {
  @PreviewText(100) doNumber?: string;
  @PreviewText(100) date?: string;
  @PreviewText(1_000) to?: string;
  @PreviewText(2_000) deliverTo?: string;
  @IsOptional() @IsInt() @Min(1) consigneePartyId?: number;
  @PreviewText(2_000) notifyParty?: string;
  @IsOptional() @IsInt() @Min(1) notifyPartyId?: number;
  @PreviewText(200) mblNumber?: string;
  @PreviewText(200) hblNumber?: string;
  @PreviewText(100) etd?: string;
  @PreviewText(100) eta?: string;
  @PreviewText(200) shipmentNumber?: string;
  @PreviewText(300) vesselVoyage?: string;
  @PreviewText(300) placeOfReceipt?: string;
  @IsOptional() @IsInt() @Min(1) placeOfReceiptPortId?: number | null;
  @PreviewText(300) portOfLoading?: string;
  @IsOptional() @IsInt() @Min(1) portOfLoadingPortId?: number | null;
  @PreviewText(300) portOfDischarge?: string;
  @IsOptional() @IsInt() @Min(1) portOfDischargePortId?: number | null;
  @PreviewText(300) placeOfDelivery?: string;
  @IsOptional() @IsInt() @Min(1) placeOfDeliveryPortId?: number | null;
  @PreviewText(300) finalDestination?: string;
  @IsOptional() @IsInt() @Min(1) finalDestinationPortId?: number | null;
  /**
   * AN service mode (e.g. `FCL/FCL - CY/CY`). Synced from Arrival Notice;
   * not edited on DO.
   */
  @PreviewText(200) serviceMode?: string;
  @PreviewText(300) cfsTerminal?: string;
  @PreviewText(2_000) note?: string;
  @PreviewText(2_000) marks?: string;
  /**
   * Shipment-level goods description mirrored from Arrival Notice (aligned
   * with Bill of Lading). Synced from AN; not edited on DO.
   */
  @PreviewText(4_000) descriptionOfGoods?: string;
  @PreviewText(300) volume?: string;
  @PreviewText(4_000) customerAttention?: string;

  /** Canonical multi-container rows (shared with Arrival Notice / BL, up to 20). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AnContainerDto)
  containers?: AnContainerDto[];

  /**
   * Legacy cargo table rows. Accepted for backward compatibility;
   * normalized into `containers` and re-derived for PDF rendering.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CargoRowDto)
  cargoRows?: CargoRowDto[];
}
