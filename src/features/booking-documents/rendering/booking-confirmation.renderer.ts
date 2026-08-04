import { PDFFont, PDFPage, rgb } from 'pdf-lib';
import { BookingConfirmationPreviewDto } from '../dto/booking-confirmation-preview.dto';
import { BookingDocumentRenderContext } from './booking-document-render-context';
import {
  BLACK,
  contentAwareHeight,
  DOC_BODY_TEXT_SIZE,
  DOC_CELL_PAD,
  DOC_FRAME_LEFT,
  DOC_FRAME_RIGHT,
  DOC_LEFT_X,
  DOC_SECTION_LABEL_SIZE,
  drawLetterhead,
  drawRule,
  drawTextBlock,
  FRAME_TEXT_INSET,
  labeledBlockStackHeight,
  labelValueStartX,
  measureTextHeight,
} from './pdf-layout';

const TEXT_SIZE = DOC_BODY_TEXT_SIZE;
/** Grid cell headings — regular weight (thinner than bold). */
const LABEL_SIZE = DOC_SECTION_LABEL_SIZE;
const HEADER_LABEL_SIZE = DOC_SECTION_LABEL_SIZE;
const FRAME_LEFT = DOC_FRAME_LEFT;
const FRAME_RIGHT = DOC_FRAME_RIGHT;
const PAGE_MIN_BOTTOM = 48;
const CELL_PAD = DOC_CELL_PAD;
/** More vertical breathing room between label and value / wrapped lines. */
const LABEL_GAP = 5;
const LINE_HEIGHT = 1.4;
const MIN_CELL_BODY = 16;
const EMPTY_TO_MIN = 28;
const INTRO =
  'We are pleased to inform you that your shipment has been confirmed as below:';
/** Title sits a bit lower under the letterhead than shared AN/DO chrome. */
const BC_TITLE_Y = 694;
const BC_BODY_TOP = 682;

/**
 * Column edges (A4 body). Extra split at 370 for Gross Weight / Measurement.
 * Matches historic booking.pdf proportions: 150 / 222 / 297 / 444.
 */
const COLS = [FRAME_LEFT, 150, 222, 297, 370, 444, FRAME_RIGHT] as const;

type GridCell = {
  label: string;
  value?: string;
  colStart: number;
  colEnd: number;
};

export function renderBookingConfirmation(
  { pdf, regular, bold, header }: BookingDocumentRenderContext,
  dto: BookingConfirmationPreviewDto,
): void {
  const page = pdf.getPage(0);
  drawLetterhead(page, header, bold, 'BOOKING CONFIRMATION', {
    clearBottom: BC_BODY_TOP,
    titleY: BC_TITLE_Y,
  });

  page.drawRectangle({
    x: FRAME_LEFT - 0.5,
    y: PAGE_MIN_BOTTOM - 1,
    width: FRAME_RIGHT - FRAME_LEFT + 1,
    height: BC_BODY_TOP - PAGE_MIN_BOTTOM + 2,
    color: rgb(1, 1, 1),
  });

  // Borderless intro band: Date / Booking No. then To + intro below.
  const metaTop = BC_BODY_TOP - 4;
  const metaBottom = drawBorderlessIntro(page, regular, bold, dto, metaTop);
  const gridTop = metaBottom - 8;
  drawRule(page, FRAME_LEFT, gridTop, FRAME_RIGHT, gridTop);

  const rows: GridCell[][] = [
    [
      {
        label: 'Vessel / Voyage:',
        value: dto.vesselVoyage,
        colStart: 0,
        colEnd: 1,
      },
      { label: 'ETD:', value: dto.etd, colStart: 1, colEnd: 2 },
      { label: 'ETA:', value: dto.eta, colStart: 2, colEnd: 3 },
      {
        label: 'Place of Receipt:',
        value: dto.placeOfReceipt,
        colStart: 3,
        colEnd: 5,
      },
      {
        label: 'Port of Loading:',
        value: dto.portOfLoading,
        colStart: 5,
        colEnd: 6,
      },
    ],
    [
      {
        label: 'Date of Pickup:',
        value: dto.pickupDate,
        colStart: 0,
        colEnd: 1,
      },
      {
        label: 'Place of Pickup:',
        value: dto.pickupPlace,
        colStart: 1,
        colEnd: 3,
      },
      {
        label: 'Port of Discharge:',
        value: dto.portOfDischarge,
        colStart: 3,
        colEnd: 5,
      },
      {
        label: 'Place of Delivery:',
        value: dto.placeOfDelivery,
        colStart: 5,
        colEnd: 6,
      },
    ],
    [
      {
        label: 'Place of Drop-off:',
        value: dto.dropoffPlace,
        colStart: 0,
        colEnd: 1,
      },
      {
        label: 'Closing Time:',
        value: dto.closingTime,
        colStart: 1,
        colEnd: 3,
      },
      {
        label: 'SI / VGM Cut-off:',
        value: formatStacked(dto.siCutoff, dto.vgmCutoff),
        colStart: 3,
        colEnd: 5,
      },
      { label: 'Contact:', value: dto.contact, colStart: 5, colEnd: 6 },
    ],
    [
      { label: 'Commodity:', value: dto.commodity, colStart: 0, colEnd: 1 },
      { label: 'Volume:', value: dto.volume, colStart: 1, colEnd: 3 },
      {
        label: 'Gross Weight (KGS):',
        value: dto.grossWeight,
        colStart: 3,
        colEnd: 4,
      },
      {
        label: 'Measurement (CBM):',
        value: dto.measurement,
        colStart: 4,
        colEnd: 5,
      },
      {
        label: 'Transit Port:',
        value: dto.transitPort,
        colStart: 5,
        colEnd: 6,
      },
    ],
    [
      {
        label: 'Special Remark:',
        value: dto.specialRemark,
        colStart: 0,
        colEnd: 3,
      },
      {
        label: 'Mother Vessel:',
        value: dto.motherVessel,
        colStart: 3,
        colEnd: 5,
      },
      {
        label: 'Mother Voyage:',
        value: dto.motherVoyage,
        colStart: 5,
        colEnd: 6,
      },
    ],
    [{ label: 'PIC:', value: dto.pic, colStart: 0, colEnd: 6 }],
  ];

  let cursor = gridTop;
  for (const row of rows) {
    const rowTop = cursor;
    cursor = drawGridRow(page, regular, bold, row, rowTop);
    drawRule(page, FRAME_LEFT, cursor, FRAME_RIGHT, cursor);
    const edges = new Set<number>();
    for (const cell of row) {
      if (cell.colStart > 0) edges.add(cell.colStart);
      if (cell.colEnd < COLS.length - 1) edges.add(cell.colEnd);
    }
    for (const edge of edges) {
      drawRule(page, COLS[edge], rowTop, COLS[edge], cursor);
    }
  }

  const frameBottom = Math.max(cursor, PAGE_MIN_BOTTOM);
  // Outer verticals only around the data grid (not the borderless intro).
  drawRule(page, FRAME_LEFT, gridTop, FRAME_LEFT, frameBottom);
  drawRule(page, FRAME_RIGHT, gridTop, FRAME_RIGHT, frameBottom);
}

/**
 * Sample layout: Date / Booking No. stacked & right-aligned on the first band
 * (no column borders). To + intro start on the next band below that, full left width.
 */
function drawBorderlessIntro(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  dto: BookingConfirmationPreviewDto,
  top: number,
): number {
  const rightBlockWidth = 200;
  const rightX = FRAME_RIGHT - FRAME_TEXT_INSET - rightBlockWidth;

  // Band 1 — Date then Booking No. only (right-aligned).
  let rightCursor = top;
  rightCursor = drawRightAlignedLabeledLine(
    page,
    regular,
    bold,
    'Date:',
    dto.date,
    rightX,
    rightBlockWidth,
    rightCursor,
  );
  rightCursor = drawRightAlignedLabeledLine(
    page,
    regular,
    bold,
    'Booking No.:',
    dto.bookingNumber,
    rightX,
    rightBlockWidth,
    rightCursor - 4,
  );

  // Band 2 — To + intro on the next rows (below Date / Booking No.).
  const toTop = rightCursor - 10;
  const toLabel = 'To:';
  const toWidth = FRAME_RIGHT - FRAME_TEXT_INSET - DOC_LEFT_X;
  page.drawText(toLabel, {
    x: DOC_LEFT_X,
    y: toTop - HEADER_LABEL_SIZE,
    size: HEADER_LABEL_SIZE,
    font: bold,
    color: BLACK,
  });
  const toValueX = labelValueStartX(
    toLabel,
    DOC_LEFT_X,
    bold,
    HEADER_LABEL_SIZE,
  );
  const toBottom = drawTextBlock(page, regular, regular, dto.to, {
    x: toValueX,
    top: toTop - 1,
    width: Math.max(40, toWidth - (toValueX - DOC_LEFT_X)),
    minHeight: contentAwareHeight(
      measureTextHeight(
        dto.to,
        regular,
        TEXT_SIZE,
        Math.max(40, toWidth - (toValueX - DOC_LEFT_X)),
        LINE_HEIGHT,
      ),
      EMPTY_TO_MIN,
    ),
    size: TEXT_SIZE,
    lineHeightFactor: LINE_HEIGHT,
  });

  const introBottom = drawTextBlock(page, regular, regular, INTRO, {
    x: DOC_LEFT_X,
    top: toBottom - 8,
    width: toWidth,
    size: TEXT_SIZE,
    lineHeightFactor: LINE_HEIGHT,
  });

  return introBottom - 4;
}

function drawRightAlignedLabeledLine(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  label: string,
  value: string | undefined,
  blockX: number,
  blockWidth: number,
  top: number,
): number {
  const valueText = (value ?? '').trim();
  const labelWidth = bold.widthOfTextAtSize(label, TEXT_SIZE);
  const gap = valueText ? 4 : 0;
  const valueWidth = valueText
    ? regular.widthOfTextAtSize(valueText, TEXT_SIZE)
    : 0;
  const totalWidth = labelWidth + gap + valueWidth;
  let x = blockX + Math.max(0, blockWidth - totalWidth);
  const y = top - TEXT_SIZE;
  page.drawText(label, {
    x,
    y,
    size: TEXT_SIZE,
    font: bold,
    color: BLACK,
  });
  if (valueText) {
    x += labelWidth + gap;
    page.drawText(valueText, {
      x,
      y,
      size: TEXT_SIZE,
      font: regular,
      color: BLACK,
    });
  }
  return top - TEXT_SIZE * LINE_HEIGHT;
}

function formatStacked(
  first: string | undefined,
  second: string | undefined,
): string | undefined {
  const lines = [first, second].map((v) => v?.trim()).filter(Boolean);
  return lines.length ? lines.join('\n') : undefined;
}

/**
 * Draw one grid row: wrapped label above wrapped value in each cell.
 * Labels and values use regular weight; looser line spacing than AN/DO.
 */
function drawGridRow(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  cells: GridCell[],
  top: number,
): number {
  const heights = cells.map((cell) => {
    const width = COLS[cell.colEnd] - COLS[cell.colStart] - CELL_PAD * 2;
    const labelH = measureTextHeight(
      cell.label,
      bold,
      LABEL_SIZE,
      width,
      LINE_HEIGHT,
    );
    const valueH = contentAwareHeight(
      measureTextHeight(cell.value, regular, TEXT_SIZE, width, LINE_HEIGHT),
      MIN_CELL_BODY,
    );
    return labeledBlockStackHeight(labelH, valueH);
  });
  const rowHeight = Math.max(...heights, 40);
  const bottom = top - rowHeight;

  for (const cell of cells) {
    const x = COLS[cell.colStart] + CELL_PAD;
    const width = COLS[cell.colEnd] - COLS[cell.colStart] - CELL_PAD * 2;
    const labelBottom = drawTextBlock(page, regular, bold, cell.label, {
      x,
      top: top - CELL_PAD,
      width,
      size: LABEL_SIZE,
      bold: true,
      lineHeightFactor: LINE_HEIGHT,
    });
    drawTextBlock(page, regular, bold, cell.value, {
      x,
      top: labelBottom - LABEL_GAP,
      width,
      size: TEXT_SIZE,
      lineHeightFactor: LINE_HEIGHT,
    });
  }

  return bottom;
}
