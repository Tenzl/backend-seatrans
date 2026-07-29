import { BookingDocumentType } from '../enums/booking-document-type.enum';

export const BOOKING_DOCUMENT_SECTION = 'booking-documents';

export const BOOKING_DOCUMENT_FILENAMES: Record<BookingDocumentType, string> = {
  [BookingDocumentType.ARRIVAL_NOTICE]: 'AN-preview.pdf',
  [BookingDocumentType.BOOKING_CONFIRMATION]: 'BOOKING-preview.pdf',
  [BookingDocumentType.DELIVERY_ORDER]: 'DO-preview.pdf',
};

export const BOOKING_DOCUMENT_TEMPLATES: Record<BookingDocumentType, string> = {
  [BookingDocumentType.ARRIVAL_NOTICE]: 'an.pdf',
  [BookingDocumentType.BOOKING_CONFIRMATION]: 'booking.pdf',
  [BookingDocumentType.DELIVERY_ORDER]: 'do.pdf',
};
