import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { AnContainerDto } from './an-container.dto';
import { CargoRowDto } from './cargo-row.dto';
import { PreviewText } from './preview-text.decorator';

export class ArrivalNoticePreviewDto {
  @PreviewText(300) agent?: string;
  @IsOptional() @IsInt() @Min(1) agentPartyId?: number;
  @PreviewText(100) date?: string;
  @PreviewText(100) anNumber?: string;
  @PreviewText(2_000) shipper?: string;
  @IsOptional() @IsInt() @Min(1) shipperPartyId?: number;
  @PreviewText(2_000) consignee?: string;
  @IsOptional() @IsInt() @Min(1) consigneePartyId?: number;
  @PreviewText(2_000) notifyParty?: string;
  @IsOptional() @IsInt() @Min(1) notifyPartyId?: number;
  @IsOptional() @IsBoolean() notifyPartySameAsConsignee?: boolean;
  @PreviewText(200) mblNumber?: string;
  @PreviewText(200) hblNumber?: string;
  @PreviewText(300) vesselVoyage?: string;
  @PreviewText(100) etd?: string;
  @PreviewText(100) eta?: string;
  /** @deprecated Prefer `etd` + `eta`. Kept for legacy payloads. */
  @PreviewText(200) etdEta?: string;
  @PreviewText(300) cfsTerminal?: string;
  @PreviewText(200) shipmentNumber?: string;
  @PreviewText(200) referenceNumber?: string;
  @PreviewText(200) billOfLadingType?: string;
  @PreviewText(300) placeOfReceipt?: string;
  @PreviewText(300) portOfLoading?: string;
  @PreviewText(300) portOfDischarge?: string;
  @PreviewText(300) placeOfDelivery?: string;
  @PreviewText(300) finalDestination?: string;
  @PreviewText(200) serviceMode?: string;
  @PreviewText(2_000) note?: string;
  @PreviewText(2_000) marks?: string;
  /** Shipment-level goods description (PDF cargo “Description of Goods”). */
  @PreviewText(4_000) descriptionOfGoods?: string;
  @PreviewText(300) volume?: string;
  @PreviewText(4_000) customerAttention?: string;

  /** Canonical multi-container rows (0..20). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AnContainerDto)
  containers?: AnContainerDto[];

  /**
   * Legacy cargo table rows. Accepted for backward compatibility;
   * normalized into `containers` and used for PDF rendering.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CargoRowDto)
  cargoRows?: CargoRowDto[];
}
