import { Injectable } from '@nestjs/common';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BILL_OF_LADING_AUTHOR_SIGNATURE_PNG,
  BILL_OF_LADING_FORM_VARIANTS,
  BILL_OF_LADING_TEMPLATE_BY_VARIANT,
  type BillOfLadingFormVariant,
  BOOKING_DOCUMENT_FILENAMES,
  BOOKING_DOCUMENT_TEMPLATES,
} from '../constants/booking-document.constants';
import {
  BookingDocumentPayload,
  BookingDocumentPreview,
} from '../booking-document.types';
import { BillOfLadingPreviewDto } from '../dto/bill-of-lading-preview.dto';
import { BookingDocumentType } from '../enums/booking-document-type.enum';
import { renderArrivalNotice } from './arrival-notice.renderer';
import {
  BL_PAGE_HEIGHT,
  BL_PAGE_WIDTH,
  renderBillOfLading,
} from './bill-of-lading.renderer';
import { renderBookingConfirmation } from './booking-confirmation.renderer';
import { BookingDocumentRenderContext } from './booking-document-render-context';
import { renderDeliveryOrder } from './delivery-order.renderer';

@Injectable()
export class BookingDocumentPdfRenderer {
  async render(
    type: BookingDocumentType,
    payload: BookingDocumentPayload,
  ): Promise<BookingDocumentPreview> {
    if (type === BookingDocumentType.BILL_OF_LADING) {
      return this.renderBillOfLading(payload as BillOfLadingPreviewDto);
    }

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
      default:
        break;
    }

    const bytes = await pdf.save({ useObjectStreams: false });
    return {
      data: Buffer.from(bytes),
      filename: BOOKING_DOCUMENT_FILENAMES[type],
    };
  }

  private resolveBillOfLadingVariant(
    payload: BillOfLadingPreviewDto,
  ): BillOfLadingFormVariant {
    if (
      payload.blFormVariant &&
      (BILL_OF_LADING_FORM_VARIANTS as readonly string[]).includes(
        payload.blFormVariant,
      )
    ) {
      return payload.blFormVariant;
    }
    // Legacy payloads used a red text stamp instead of the surrendered blank.
    if (payload.showSurrendered === 'yes') {
      return 'surrendered';
    }
    return 'non_negotiable';
  }

  private async renderBillOfLading(
    payload: BillOfLadingPreviewDto,
  ): Promise<BookingDocumentPreview> {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const page = pdf.addPage([BL_PAGE_WIDTH, BL_PAGE_HEIGHT]);

    const templateFile =
      BILL_OF_LADING_TEMPLATE_BY_VARIANT[
        this.resolveBillOfLadingVariant(payload)
      ];

    const [regularBytes, boldBytes, templateBytes, signatureBytes] =
      await Promise.all([
        this.readAsset('fonts', 'DejaVuSans.ttf'),
        this.readAsset('fonts', 'DejaVuSans-Bold.ttf'),
        this.readAsset('templates', templateFile),
        this.readAsset(BILL_OF_LADING_AUTHOR_SIGNATURE_PNG),
      ]);

    const regular = await pdf.embedFont(regularBytes, { subset: true });
    const bold = await pdf.embedFont(boldBytes, { subset: true });
    const template = await pdf.embedPng(templateBytes);
    const managerStamp = await pdf.embedPng(signatureBytes);

    page.drawImage(template, {
      x: 0,
      y: 0,
      width: BL_PAGE_WIDTH,
      height: BL_PAGE_HEIGHT,
    });

    renderBillOfLading(
      {
        pdf,
        regular,
        bold,
        header: template,
        managerStamp,
      },
      payload,
    );

    const bytes = await pdf.save({ useObjectStreams: false });
    return {
      data: Buffer.from(bytes),
      filename: BOOKING_DOCUMENT_FILENAMES[BookingDocumentType.BILL_OF_LADING],
    };
  }

  private async openTemplate(type: BookingDocumentType): Promise<PDFDocument> {
    const templateName = BOOKING_DOCUMENT_TEMPLATES[type];
    if (!templateName) {
      throw new Error(`No PDF template configured for document type ${type}`);
    }
    return PDFDocument.load(await this.readAsset('templates', templateName));
  }

  private readAsset(...segments: string[]): Promise<Buffer> {
    return readFile(join(__dirname, '..', 'assets', ...segments));
  }
}
