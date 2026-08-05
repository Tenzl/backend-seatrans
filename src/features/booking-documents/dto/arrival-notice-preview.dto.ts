import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
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
  @PreviewText(200) mblNumber?: string;
  @PreviewText(200) hblNumber?: string;
  @PreviewText(300) vesselVoyage?: string;
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
  @PreviewText(300) volume?: string;
  @PreviewText(4_000) customerAttention?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CargoRowDto)
  cargoRows?: CargoRowDto[];
}
