import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { BILL_OF_LADING_FORM_VARIANTS } from '../constants/booking-document.constants';
import { AnContainerDto } from './an-container.dto';
import { PreviewText } from './preview-text.decorator';

/** Payload for FIATA FBL overlay on a selectable blank template. */
export class BillOfLadingPreviewDto {
  @PreviewText(100) fblNumber?: string;

  @PreviewText(2_000) consignor?: string;
  @IsOptional() @IsInt() @Min(1) shipperPartyId?: number;
  @PreviewText(2_000) consignedToOrderOf?: string;
  @IsOptional() @IsInt() @Min(1) consigneePartyId?: number;
  @PreviewText(2_000) notifyAddress?: string;
  @IsOptional() @IsInt() @Min(1) notifyPartyId?: number;
  /** Same as Consignee — mirrors Consigned to order of into Notify address. */
  @IsOptional() @IsBoolean() notifyPartySameAsConsignee?: boolean;

  @PreviewText(300) placeOfReceipt?: string;
  /** Vessel and voyage in one string (e.g. `SITC MINHE / 2615N`). */
  @PreviewText(300) oceanVessel?: string;
  @PreviewText(300) portOfLoading?: string;
  @PreviewText(300) portOfDischarge?: string;
  @PreviewText(300) placeOfDelivery?: string;

  /**
   * AN service mode (e.g. `FCL/FCL - CY/CY`) — PDF marks column row 1.
   * Structured cargo layout (when containers/serviceMode present):
   * row1 serviceMode + volume STC; then one marks line per container
   * (`containerNo / sealNo / type`) with that row’s GW/measurement;
   * then shippingMark + descriptionOfGoods. Synced from AN `serviceMode`.
   */
  @PreviewText(200) serviceMode?: string;

  /**
   * Editable shipping mark beside descriptionOfGoods on the BL PDF.
   * BL-owned; empty prints blank (never auto-injected as "N/M").
   */
  @PreviewText(2_000) shippingMark?: string;
  /** @deprecated Legacy alias; migrated to `shippingMark` on validate. */
  @PreviewText(2_000) marksAndNumbers?: string;
  @PreviewText(1_000) numberAndKindOfPackages?: string;
  @PreviewText(4_000) descriptionOfGoods?: string;
  @PreviewText(500) grossWeight?: string;
  @PreviewText(500) measurement?: string;

  /** Canonical multi-container rows (shared with Arrival Notice). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AnContainerDto)
  containers?: AnContainerDto[];

  /** e.g. FREIGHT COLLECT */
  @PreviewText(300) freightTerms?: string;
  /** On-board date only; PDF always prefixes with fixed "CLEAN ON BOARD". */
  @PreviewText(100) cleanOnBoardDate?: string;

  @PreviewText(500) declarationOfInterest?: string;
  @PreviewText(500) declaredValue?: string;

  @PreviewText(300) freightAmount?: string;
  @PreviewText(300) freightPayableAt?: string;
  @PreviewText(300) placeOfIssue?: string;
  @PreviewText(100) dateOfIssue?: string;
  @PreviewText(100) numberOfOriginals?: string;

  /** not_covered | covered | empty */
  @IsOptional()
  @IsIn(['', 'not_covered', 'covered'])
  cargoInsurance?: '' | 'not_covered' | 'covered';

  @PreviewText(2_000) deliveryApplyTo?: string;

  /** Which blank BL form PNG to overlay. Defaults to non_negotiable. */
  @IsOptional()
  @IsIn([...BILL_OF_LADING_FORM_VARIANTS])
  blFormVariant?: (typeof BILL_OF_LADING_FORM_VARIANTS)[number];
}
