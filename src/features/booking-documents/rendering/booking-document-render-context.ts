import { PDFDocument, PDFFont, PDFImage } from 'pdf-lib';

/**
 * Dual-font PDF context:
 *   regular / bold     — Arial (body, values, cargo, terms items)
 *   heading / headingRegular — DejaVu Sans (titles, section/detail labels)
 */
export interface BookingDocumentRenderContext {
  pdf: PDFDocument;
  /** Arial Regular — body / values / cargo / terms items. */
  regular: PDFFont;
  /** Arial Bold — emphasized content (e.g. party name on BC To line). */
  bold: PDFFont;
  /** DejaVu Sans Bold — letterhead titles, section & field labels. */
  heading: PDFFont;
  /** DejaVu Sans Regular — optional structural text when bold is too heavy. */
  headingRegular: PDFFont;
  header: PDFImage;
  /** DO "For SEATRANS" manager stamp (optional). */
  managerStamp?: PDFImage;
}
