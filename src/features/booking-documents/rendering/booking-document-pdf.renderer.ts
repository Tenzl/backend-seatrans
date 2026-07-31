import { Injectable } from '@nestjs/common';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BOOKING_DOCUMENT_FILENAMES,
  BOOKING_DOCUMENT_TEMPLATES,
} from '../constants/booking-document.constants';
import {
  BookingDocumentPayload,
  BookingDocumentPreview,
} from '../booking-document.types';
import { BookingDocumentType } from '../enums/booking-document-type.enum';
import { renderArrivalNotice } from './arrival-notice.renderer';
import { renderBookingConfirmation } from './booking-confirmation.renderer';
import { BookingDocumentRenderContext } from './booking-document-render-context';
import { renderDeliveryOrder } from './delivery-order.renderer';

@Injectable()
export class BookingDocumentPdfRenderer {
  async render(
    type: BookingDocumentType,
    payload: BookingDocumentPayload,
  ): Promise<BookingDocumentPreview> {
    const pdf = await this.openTemplate(type);
    pdf.registerFontkit(fontkit);

    const [regularBytes, boldBytes] = await Promise.all([
      this.readAsset('fonts', 'DejaVuSans.ttf'),
      this.readAsset('fonts', 'DejaVuSans-Bold.ttf'),
    ]);
    // pdf-lib mutates the document context while allocating embedded objects.
    // Keep these sequential so concurrent HTTP previews cannot corrupt refs.
    const regular = await pdf.embedFont(regularBytes, { subset: true });
    const bold = await pdf.embedFont(boldBytes, { subset: true });
    const header = await pdf.embedPng(
      await this.readAsset('author-header.png'),
    );
    const managerStamp = await pdf.embedJpg(
      await this.readAsset('authorSignature.jpg'),
    );
    const context: BookingDocumentRenderContext = {
      pdf,
      regular,
      bold,
      header,
      managerStamp,
    };

    switch (type) {
      case BookingDocumentType.ARRIVAL_NOTICE:
        renderArrivalNotice(context, payload);
        break;
      case BookingDocumentType.BOOKING_CONFIRMATION:
        renderBookingConfirmation(context, payload);
        break;
      case BookingDocumentType.DELIVERY_ORDER:
        renderDeliveryOrder(context, payload);
        break;
    }

    const bytes = await pdf.save({ useObjectStreams: false });
    return {
      data: Buffer.from(bytes),
      filename: BOOKING_DOCUMENT_FILENAMES[type],
    };
  }

  private async openTemplate(type: BookingDocumentType): Promise<PDFDocument> {
    return PDFDocument.load(
      await this.readAsset('templates', BOOKING_DOCUMENT_TEMPLATES[type]),
    );
  }

  private readAsset(...segments: string[]): Promise<Buffer> {
    return readFile(join(__dirname, '..', 'assets', ...segments));
  }
}
