import { BookingDocumentType } from '../enums/booking-document-type.enum';

export const BOOKING_DOCUMENT_SECTION = 'booking-documents';

export const BOOKING_DOCUMENT_FILENAMES: Record<BookingDocumentType, string> = {
  [BookingDocumentType.ARRIVAL_NOTICE]: 'AN-preview.pdf',
  [BookingDocumentType.BOOKING_CONFIRMATION]: 'BOOKING-preview.pdf',
  [BookingDocumentType.DELIVERY_ORDER]: 'DO-preview.pdf',
  [BookingDocumentType.BILL_OF_LADING]: 'BL-preview.pdf',
};

/** PDF blank templates for drawn documents. BL uses a JPEG overlay instead. */
export const BOOKING_DOCUMENT_TEMPLATES: Partial<
  Record<BookingDocumentType, string>
> = {
  [BookingDocumentType.ARRIVAL_NOTICE]: 'an.pdf',
  [BookingDocumentType.BOOKING_CONFIRMATION]: 'booking.pdf',
  [BookingDocumentType.DELIVERY_ORDER]: 'do.pdf',
};

export const BILL_OF_LADING_FORM_VARIANTS = [
  'non_negotiable',
  'original',
  'surrendered',
] as const;

export type BillOfLadingFormVariant =
  (typeof BILL_OF_LADING_FORM_VARIANTS)[number];

/** Optimized JPEG blank templates under `assets/templates/`. */
export const BILL_OF_LADING_TEMPLATE_BY_VARIANT: Record<
  BillOfLadingFormVariant,
  string
> = {
  non_negotiable: 'bl-non-negotiable.jpg',
  original: 'bl-original.jpg',
  surrendered: 'bl-original.jpg',
};

export const BILL_OF_LADING_AUTHOR_SIGNATURE_PNG = 'authorSignature-nobg.png';
