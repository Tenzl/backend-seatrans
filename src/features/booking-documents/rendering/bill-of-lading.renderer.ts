import { PDFFont, PDFPage, rgb } from 'pdf-lib';
import type { BillOfLadingPreviewDto } from '../dto/bill-of-lading-preview.dto';
import type { BookingDocumentRenderContext } from './booking-document-render-context';

/** A4 — matches `FILLED UP_ SUR BL.pdf` page size. */
export const BL_PAGE_WIDTH = 595.28;
export const BL_PAGE_HEIGHT = 841.89;

/**
 * Fit text to BL blank PNG grid (A4). Official sample uses Roboto 8.1
 * on a blank whose horizontals sit ~7.5pt lower; values here are absolute tops
 * on our blank, just below each cell label (not on the bottom rule).
 */
const FONT_SIZE = 8.0;
const FONT_SIZE_SMALL = 7.5;
const FONT_SIZE_FBL = 10.5;
const LINE_GAP = 1.15;
const BLACK = rgb(0, 0, 0);

type TopLeft = { x: number; top: number; maxWidth: number; maxLines?: number };

/**
 * Absolute A4 coordinates shared by BL blank variants.
 * Transport row rules ≈ 240.25 | 263.25 | 286.75 | 309.0
 * Voyage column ≈ 157; receipt/loading/delivery values ≈ 193.8
 * Cargo columns ≈ marks 69 | packages 178 | desc 242 | weight 441 | meas 520
 * Footer rules ≈ 701.75 | 725.5 | 750.25; splits ≈ 255 | 379
 */
const BOX = {
  fblNumber: { x: 438.8, top: 36.0, maxWidth: 120, maxLines: 1 },
  consignor: { x: 62.5, top: 42.0, maxWidth: 230, maxLines: 6 },
  consignedToOrderOf: { x: 62.5, top: 112.0, maxWidth: 230, maxLines: 5 },
  notifyAddress: { x: 62.5, top: 181.0, maxWidth: 230, maxLines: 5 },
  placeOfReceipt: { x: 193.8, top: 248.0, maxWidth: 160, maxLines: 2 },
  oceanVessel: { x: 62.5, top: 271.0, maxWidth: 90, maxLines: 2 },
  voyageNumber: { x: 157.0, top: 271.0, maxWidth: 32, maxLines: 1 },
  portOfLoading: { x: 193.8, top: 272.5, maxWidth: 160, maxLines: 2 },
  portOfDischarge: { x: 61.0, top: 294.5, maxWidth: 132, maxLines: 2 },
  placeOfDelivery: { x: 193.8, top: 294.5, maxWidth: 160, maxLines: 2 },
  marksAndNumbers: { x: 69.0, top: 323.5, maxWidth: 100, maxLines: 18 },
  numberAndKindOfPackages: { x: 178.0, top: 323.5, maxWidth: 56, maxLines: 14 },
  descriptionOfGoods: { x: 242.0, top: 323.5, maxWidth: 188, maxLines: 20 },
  grossWeight: { x: 441.0, top: 323.5, maxWidth: 72, maxLines: 10 },
  measurement: { x: 520.0, top: 323.5, maxWidth: 52, maxLines: 10 },
  freightTerms: { x: 242.0, top: 528.0, maxWidth: 200, maxLines: 2 },
  cleanOnBoard: { x: 242.0, top: 538.0, maxWidth: 200, maxLines: 2 },
  declarationOfInterest: { x: 72.0, top: 576.0, maxWidth: 210, maxLines: 3 },
  declaredValue: { x: 310.0, top: 576.0, maxWidth: 210, maxLines: 3 },
  freightAmount: { x: 76.5, top: 715.0, maxWidth: 110, maxLines: 2 },
  freightPayableAt: { x: 258.0, top: 715.0, maxWidth: 121, maxLines: 2 },
  placeOfIssue: { x: 385.5, top: 715.0, maxWidth: 115, maxLines: 2 },
  dateOfIssue: { x: 507.8, top: 715.0, maxWidth: 70, maxLines: 1 },
  numberOfOriginals: { x: 267.8, top: 735.5, maxWidth: 80, maxLines: 1 },
  deliveryApplyTo: { x: 74.2, top: 761.0, maxWidth: 280, maxLines: 5 },
  stamp: { x: 400.0, top: 722.0, maxWidth: 160, maxLines: 1 },
  insuranceNotCovered: { x: 68.5, top: 735.5 },
  insuranceCovered: { x: 121.0, top: 735.5 },
} as const;

function pdfYFromTop(top: number, fontSize: number, font: PDFFont): number {
  // Baseline so glyph tops land on `top` (pdf-lib origin = bottom-left).
  // DejaVuSans heightAtSize(descender:false) under-reports ink top by ~0.25*size.
  const height = font.heightAtSize(fontSize, { descender: false });
  return BL_PAGE_HEIGHT - top - height - fontSize * 0.25;
}

function wrapLines(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const lines: string[] = [];
  for (const paragraph of normalized.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      if (lines.length >= maxLines) break;
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const candidate = `${current} ${words[i]}`;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        if (lines.length >= maxLines) return lines;
        current = words[i];
      }
    }
    lines.push(current);
    if (lines.length >= maxLines) break;
  }
  return lines.slice(0, maxLines);
}

function drawBoxText(
  page: PDFPage,
  font: PDFFont,
  value: string | undefined,
  field: TopLeft,
  fontSize = FONT_SIZE,
) {
  const lineStep = fontSize + LINE_GAP;
  const lines = wrapLines(
    value ?? '',
    font,
    fontSize,
    field.maxWidth,
    field.maxLines ?? 6,
  );
  lines.forEach((line, index) => {
    page.drawText(line, {
      x: field.x,
      y: pdfYFromTop(field.top + index * lineStep, fontSize, font),
      size: fontSize,
      font,
      color: BLACK,
    });
  });
}

function drawCheckMark(
  page: PDFPage,
  font: PDFFont,
  x: number,
  top: number,
) {
  page.drawText('X', {
    x,
    y: pdfYFromTop(top, FONT_SIZE, font),
    size: FONT_SIZE,
    font,
    color: BLACK,
  });
}

/**
 * Overlay typed FBL fields onto the embedded blank page.
 * Caller must already draw the selected template image full-bleed on page 0.
 * Author signature is always drawn when available in the render context.
 */
export function renderBillOfLading(
  context: BookingDocumentRenderContext,
  payload: BillOfLadingPreviewDto,
): void {
  const page = context.pdf.getPage(0);
  const font = context.regular;
  const bold = context.bold;

  drawBoxText(page, bold, payload.fblNumber, BOX.fblNumber, FONT_SIZE_FBL);
  drawBoxText(page, font, payload.consignor, BOX.consignor);
  drawBoxText(page, font, payload.consignedToOrderOf, BOX.consignedToOrderOf);
  drawBoxText(page, font, payload.notifyAddress, BOX.notifyAddress);
  drawBoxText(page, font, payload.placeOfReceipt, BOX.placeOfReceipt);
  drawBoxText(page, font, payload.oceanVessel, BOX.oceanVessel);
  drawBoxText(page, font, payload.voyageNumber, BOX.voyageNumber);
  drawBoxText(page, font, payload.portOfLoading, BOX.portOfLoading);
  drawBoxText(page, font, payload.portOfDischarge, BOX.portOfDischarge);
  drawBoxText(page, font, payload.placeOfDelivery, BOX.placeOfDelivery);

  drawBoxText(page, font, payload.marksAndNumbers, BOX.marksAndNumbers);
  drawBoxText(
    page,
    font,
    payload.numberAndKindOfPackages,
    BOX.numberAndKindOfPackages,
  );
  drawBoxText(page, font, payload.descriptionOfGoods, BOX.descriptionOfGoods);
  drawBoxText(page, font, payload.grossWeight, BOX.grossWeight);
  drawBoxText(page, font, payload.measurement, BOX.measurement);

  drawBoxText(page, bold, payload.freightTerms, BOX.freightTerms);
  drawBoxText(page, font, payload.cleanOnBoard, BOX.cleanOnBoard);
  drawBoxText(
    page,
    font,
    payload.declarationOfInterest,
    BOX.declarationOfInterest,
    FONT_SIZE_SMALL,
  );
  drawBoxText(
    page,
    font,
    payload.declaredValue,
    BOX.declaredValue,
    FONT_SIZE_SMALL,
  );

  drawBoxText(page, font, payload.freightAmount, BOX.freightAmount);
  drawBoxText(page, font, payload.freightPayableAt, BOX.freightPayableAt);
  drawBoxText(page, font, payload.placeOfIssue, BOX.placeOfIssue);
  drawBoxText(page, font, payload.dateOfIssue, BOX.dateOfIssue);
  drawBoxText(page, font, payload.numberOfOriginals, BOX.numberOfOriginals);
  drawBoxText(page, font, payload.deliveryApplyTo, BOX.deliveryApplyTo);

  if (payload.cargoInsurance === 'not_covered') {
    drawCheckMark(
      page,
      bold,
      BOX.insuranceNotCovered.x,
      BOX.insuranceNotCovered.top,
    );
  } else if (payload.cargoInsurance === 'covered') {
    drawCheckMark(
      page,
      bold,
      BOX.insuranceCovered.x,
      BOX.insuranceCovered.top,
    );
  }

  if (context.managerStamp) {
    const stampW = 95;
    const stampH =
      (context.managerStamp.height / context.managerStamp.width) * stampW;
    page.drawImage(context.managerStamp, {
      x: BOX.stamp.x + 20,
      y: BL_PAGE_HEIGHT - BOX.stamp.top - stampH,
      width: stampW,
      height: stampH,
      opacity: 0.92,
    });
  }
}
