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
  DOC_HEADER_BOTTOM,
  DOC_HEADER_TOP,
  DOC_LABEL_GAP,
  DOC_LEFT_X,
  DOC_SECTION_LABEL_SIZE,
  drawLetterhead,
  drawMetaHeaderRow,
  drawRule,
  drawTextBlock,
  FRAME_TEXT_INSET,
  labeledBlockStackHeight,
  labelValueStartX,
  measureTextHeight,
} from './pdf-layout';

const TEXT_SIZE = DOC_BODY_TEXT_SIZE;
/** Grid cell headings (Contact, Volume, …) — same size as AN/DO section titles. */
const LABEL_SIZE = DOC_SECTION_LABEL_SIZE;
const HEADER_LABEL_SIZE = DOC_SECTION_LABEL_SIZE;
const FRAME_LEFT = DOC_FRAME_LEFT;
const FRAME_RIGHT = DOC_FRAME_RIGHT;
const PAGE_MIN_BOTTOM = 48;
const CELL_PAD = DOC_CELL_PAD;
const LABEL_GAP = DOC_LABEL_GAP;
const MIN_CELL_BODY = 16;
const EMPTY_TO_MIN = 28;

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
    clearBottom: DOC_HEADER_TOP,
    titleY: 708,
  });

  page.drawRectangle({
    x: FRAME_LEFT - 0.5,
    y: PAGE_MIN_BOTTOM - 1,
    width: FRAME_RIGHT - FRAME_LEFT + 1,
    height: DOC_HEADER_TOP - PAGE_MIN_BOTTOM + 2,
    color: rgb(1, 1, 1),
  });

  // AN-style 3-cell meta header: empty left cell + Date + Booking No.
  drawMetaHeaderRow(page, regular, bold, {
    mid: { label: 'Date:', value: dto.date },
    right: { label: 'Booking No.:', value: dto.bookingNumber },
  });

  const toLabel = 'To:';
  const toLabelY = 662;
  const toX = DOC_LEFT_X;
  page.drawText(toLabel, {
    x: toX,
    y: toLabelY,
    size: HEADER_LABEL_SIZE,
    font: bold,
    color: BLACK,
  });
  const toValueX = labelValueStartX(toLabel, toX, bold, HEADER_LABEL_SIZE);
  const toBottom = drawTextBlock(page, regular, bold, dto.to, {
    x: toValueX,
    top: toLabelY - LABEL_GAP,
    width: FRAME_RIGHT - FRAME_TEXT_INSET - toValueX,
    minHeight: contentAwareHeight(
      measureTextHeight(
        dto.to,
        regular,
        TEXT_SIZE,
        FRAME_RIGHT - FRAME_TEXT_INSET - toValueX,
      ),
      EMPTY_TO_MIN,
    ),
    size: TEXT_SIZE,
  });
  const gridTop = toBottom - 10;
  drawRule(page, FRAME_LEFT, gridTop, FRAME_RIGHT, gridTop);

  const rows: GridCell[][] = [
    [
      { label: 'Vessel / Voyage:', value: dto.vesselVoyage, colStart: 0, colEnd: 1 },
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
      { label: 'Date of Pickup:', value: dto.pickupDate, colStart: 0, colEnd: 1 },
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
      { label: 'Transit Port:', value: dto.transitPort, colStart: 5, colEnd: 6 },
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
    // One continuous horizontal rule across the full frame for this row.
    drawRule(page, FRAME_LEFT, cursor, FRAME_RIGHT, cursor);
    // Vertical rules only at this row's cell boundaries (no cuts through spans).
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
  drawRule(page, FRAME_LEFT, DOC_HEADER_BOTTOM, FRAME_LEFT, frameBottom);
  drawRule(page, FRAME_RIGHT, DOC_HEADER_BOTTOM, FRAME_RIGHT, frameBottom);
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
 * Row height uses shared labeledBlockStackHeight (DOC_CELL_PAD top+bottom)
 * so BC matches AN/DO labeled blocks.
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
    const labelH = measureTextHeight(cell.label, bold, LABEL_SIZE, width);
    const valueH = contentAwareHeight(
      measureTextHeight(cell.value, regular, TEXT_SIZE, width),
      MIN_CELL_BODY,
    );
    return labeledBlockStackHeight(labelH, valueH);
  });
  const rowHeight = Math.max(...heights, 36);
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
    });
    drawTextBlock(page, regular, bold, cell.value, {
      x,
      top: labelBottom - LABEL_GAP,
      width,
      size: TEXT_SIZE,
    });
  }

  return bottom;
}
