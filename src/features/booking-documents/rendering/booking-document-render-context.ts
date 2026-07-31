import { PDFDocument, PDFFont, PDFImage } from 'pdf-lib';

export interface BookingDocumentRenderContext {
  pdf: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  header: PDFImage;
  /** DO "For SEATRANS" manager stamp (optional). */
  managerStamp?: PDFImage;
}
