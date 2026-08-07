import { Injectable } from '@nestjs/common';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont } from 'pdf-lib';
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

type EmbeddedDocFonts = {
  regular: PDFFont;
  bold: PDFFont;
  heading: PDFFont;
  headingRegular: PDFFont;
};

@Injectable()
export class BookingDocumentPdfRenderer {
  private readonly assetCache = new Map<string, Promise<Buffer>>();

  async render(
    type: BookingDocumentType,
    payload: BookingDocumentPayload,
  ): Promise<BookingDocumentPreview> {
    if (type === BookingDocumentType.BILL_OF_LADING) {
      return this.renderBillOfLading(payload);
    }

    const pdf = await this.openTemplate(type);
    pdf.registerFontkit(fontkit);

    const fonts = await this.embedDocFonts(pdf);
    const header = await pdf.embedPng(
      await this.readAsset('author-header.png'),
    );
    const managerStamp = await pdf.embedJpg(
      await this.readAsset('authorSignature.jpg'),
    );
    const context: BookingDocumentRenderContext = {
      pdf,
      ...fonts,
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
    return 'non_negotiable';
  }

  private async renderBillOfLading(
    payload: BillOfLadingPreviewDto,
  ): Promise<BookingDocumentPreview> {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const page = pdf.addPage([BL_PAGE_WIDTH, BL_PAGE_HEIGHT]);

    const variant = this.resolveBillOfLadingVariant(payload);
    const templateFile = BILL_OF_LADING_TEMPLATE_BY_VARIANT[variant];

    const [fonts, templateBytes, signatureBytes] = await Promise.all([
      this.embedDocFonts(pdf),
      this.readAsset('templates', templateFile),
      this.readAsset(BILL_OF_LADING_AUTHOR_SIGNATURE_PNG),
    ]);

    const template = await pdf.embedJpg(templateBytes);
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
        ...fonts,
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

  /**
   * Arial = content; DejaVu = headings/labels.
   * Embed sequentially so concurrent previews cannot corrupt pdf-lib refs.
   */
  private async embedDocFonts(pdf: PDFDocument): Promise<EmbeddedDocFonts> {
    const [arialRegular, arialBold, dejaVuRegular, dejaVuBold] =
      await Promise.all([
        this.readAsset('fonts', 'Arial.ttf'),
        this.readAsset('fonts', 'Arial-Bold.ttf'),
        this.readAsset('fonts', 'DejaVuSans.ttf'),
        this.readAsset('fonts', 'DejaVuSans-Bold.ttf'),
      ]);

    const regular = await pdf.embedFont(arialRegular, { subset: true });
    const bold = await pdf.embedFont(arialBold, { subset: true });
    const headingRegular = await pdf.embedFont(dejaVuRegular, {
      subset: true,
    });
    const heading = await pdf.embedFont(dejaVuBold, { subset: true });
    return { regular, bold, heading, headingRegular };
  }

  private async openTemplate(type: BookingDocumentType): Promise<PDFDocument> {
    const templateName = BOOKING_DOCUMENT_TEMPLATES[type];
    if (!templateName) {
      throw new Error(`No PDF template configured for document type ${type}`);
    }
    return PDFDocument.load(await this.readAsset('templates', templateName));
  }

  private readAsset(...segments: string[]): Promise<Buffer> {
    const assetPath = join(__dirname, '..', 'assets', ...segments);
    const cached = this.assetCache.get(assetPath);
    if (cached) {
      return cached;
    }

    const loading = readFile(assetPath).catch((error: unknown) => {
      this.assetCache.delete(assetPath);
      throw error;
    });
    this.assetCache.set(assetPath, loading);
    return loading;
  }
}
