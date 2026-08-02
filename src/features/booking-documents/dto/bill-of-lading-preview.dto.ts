import { IsIn, IsOptional } from 'class-validator';
import { BILL_OF_LADING_FORM_VARIANTS } from '../constants/booking-document.constants';
import { PreviewText } from './preview-text.decorator';

/** Payload for FIATA FBL overlay on a selectable blank template. */
export class BillOfLadingPreviewDto {
  @PreviewText(100) fblNumber?: string;

  @PreviewText(2_000) consignor?: string;
  @PreviewText(2_000) consignedToOrderOf?: string;
  @PreviewText(2_000) notifyAddress?: string;

  @PreviewText(300) placeOfReceipt?: string;
  @PreviewText(300) oceanVessel?: string;
  @PreviewText(200) voyageNumber?: string;
  @PreviewText(300) portOfLoading?: string;
  @PreviewText(300) portOfDischarge?: string;
  @PreviewText(300) placeOfDelivery?: string;

  @PreviewText(2_000) marksAndNumbers?: string;
  @PreviewText(1_000) numberAndKindOfPackages?: string;
  @PreviewText(4_000) descriptionOfGoods?: string;
  @PreviewText(200) grossWeight?: string;
  @PreviewText(200) measurement?: string;

  /** e.g. FREIGHT COLLECT */
  @PreviewText(300) freightTerms?: string;
  /** e.g. CLEAN ON BOARD Jun 14, 2026 */
  @PreviewText(300) cleanOnBoard?: string;

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

  /**
   * Which blank BL form PNG to overlay.
   * Defaults to non_negotiable; legacy `showSurrendered=yes` maps to surrendered.
   */
  @IsOptional()
  @IsIn([...BILL_OF_LADING_FORM_VARIANTS])
  blFormVariant?: (typeof BILL_OF_LADING_FORM_VARIANTS)[number];

  /** @deprecated Prefer blFormVariant=`surrendered` (blank template). Kept for legacy payloads. */
  @IsOptional()
  @IsIn(['', 'yes'])
  showSurrendered?: '' | 'yes';

  /** @deprecated Signature is always drawn. Kept for legacy payloads. */
  @IsOptional()
  @IsIn(['', 'yes'])
  includeCompanyStamp?: '' | 'yes';
}
