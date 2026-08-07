import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import { resolveBookingVolumeDisplay } from '../cargo-volume';
import { BookingConfirmationPreviewDto } from '../dto/booking-confirmation-preview.dto';
import { BookingDocumentRenderContext } from './booking-document-render-context';
import { formatPdfDateTime } from './pdf-schedule-date';
import {
  BLACK,
  contentAwareHeight,
  DOC_BODY_TEXT_SIZE,
  DOC_CELL_PAD,
  DOC_CONTINUATION_TITLE_SIZE,
  DOC_FRAME_LEFT,
  DOC_FRAME_RIGHT,
  DOC_LEFT_X,
  DOC_LINE_HEIGHT_FACTOR,
  DOC_SECTION_LABEL_SIZE,
  DOC_TABLE_HEADER_SIZE,
  DOC_TERMS_TEXT_SIZE,
  drawLetterhead,
  drawRule,
  drawTextBlock,
  FRAME_TEXT_INSET,
  labeledBlockStackHeight,
  labelValueStartX,
  measureTextHeight,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  partyDisplayName,
  RULE_THICKNESS,
} from './pdf-layout';

const TEXT_SIZE = DOC_BODY_TEXT_SIZE;
/** Section labels (Terms heading, Date / Booking No.) — DejaVu Bold. */
const SECTION_LABEL_SIZE = DOC_SECTION_LABEL_SIZE;
/** Grid cell headings (Vessel / Voyage, …) — DejaVu Bold. */
const GRID_LABEL_SIZE = DOC_TABLE_HEADER_SIZE;
/** Terms numbered items — same size as body content. */
const TERMS_TEXT_SIZE = DOC_TERMS_TEXT_SIZE;
/**
 * "To:" label (DejaVu) + client name (Arial Bold) share one size so the
 * address line reads as one unit. Both use the same PDF baseline (see
 * {@link bookingConfirmationToLineLayout}).
 */
const TO_LINE_SIZE = DOC_SECTION_LABEL_SIZE;

/**
 * Layout for the dual-font "To:" band.
 * pdf-lib `drawText` y is the glyph baseline; `drawTextBlock` places the first
 * line at `top - size`. Keep `blockTop === baselineY + size` so label and name
 * share one baseline even when DejaVu vs Arial metrics differ at the same size.
 */
export function bookingConfirmationToLineLayout(
  toTop: number,
  size: number = TO_LINE_SIZE,
): { baselineY: number; blockTop: number; size: number } {
  const baselineY = toTop - size;
  return { baselineY, blockTop: baselineY + size, size };
}

const FRAME_LEFT = DOC_FRAME_LEFT;
const FRAME_RIGHT = DOC_FRAME_RIGHT;
const PAGE_MIN_BOTTOM = 48;
const CELL_PAD = DOC_CELL_PAD;
/** More vertical breathing room between label and value / wrapped lines. */
const LABEL_GAP = 5;
const LINE_HEIGHT = DOC_LINE_HEIGHT_FACTOR;
const MIN_CELL_BODY = 16;
const EMPTY_TO_MIN = 28;
const INTRO =
  'We are pleased to inform you that your shipment has been confirmed as below:';
/** Title sits a bit lower under the letterhead than shared AN/DO chrome. */
const BC_TITLE_Y = 694;
const BC_BODY_TOP = 682;
/** Gap between the data grid bottom rule and Terms heading. */
const TERMS_GAP = 12;
/** Space under the Terms heading before the first item. */
const TERMS_HEADING_GAP = 3;
/**
 * Left inset for numbered term items from DOC_LEFT_X.
 * The "Terms and Conditions:" heading stays at DOC_LEFT_X (no inset).
 */
const TERMS_LEFT_INSET = 8;
/** Extra indent for numbered items `1.`, `2.`, … beyond TERMS_LEFT_INSET. */
const TERMS_ITEM_INDENT = 3;
/** Vertical gap between numbered term items. */
const TERMS_ITEM_GAP = 7;
/** Extra right inset so terms wrap slightly inside the form frame. */
const TERMS_RIGHT_INSET = 30;
const TERMS_CONTINUATION_TOP = 790;

/** Static legal copy shown below the booking confirmation grid (no border). */
export const BOOKING_CONFIRMATION_TERMS: readonly string[] = [
  'The booking information is checked and accepted by the client/shipper before picking-up the empty container out of the C/Y.',
  "Booking confirmation is subject to the carrier's space and equipment availability.",
  "Vessel's sailing schedule may be changed without prior notice.",
  'Customers are not allowed to exchanged containers between bookings.If doing so, swapping fee will be applied.',
  "The container condition to be checked carefully & accepted before gating out. if any container's damage found then, the arising charge/expense to be for the client's account.",
  "Any damage/expenses happen due to client/shipper's wrong weight declaration which to be for the client/shipper's account.",
];

/**
 * Column edges (A4 body). Extra split at 370 for Gross Weight / Measurement.
 * Matches historic booking.pdf proportions: 150 / 222 / 297 / 444.
 */
const COLS = [FRAME_LEFT, 150, 222, 297, 370, 444, FRAME_RIGHT] as const;

type StackedCutoffBlock = {
  label: string;
  value: string;
};

type GridCell = {
  label: string;
  value?: string;
  colStart: number;
  colEnd: number;
  /** SI / VGM stacked blocks with an internal divider (drawn specially). */
  stackedCutoff?: StackedCutoffBlock[];
};

export function renderBookingConfirmation(
  { pdf, regular, bold, heading, header }: BookingDocumentRenderContext,
  dto: BookingConfirmationPreviewDto,
): void {
  const page = pdf.getPage(0);
  drawLetterhead(page, header, heading, 'BOOKING CONFIRMATION', {
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
  const metaBottom = drawBorderlessIntro(
    page,
    regular,
    bold,
    heading,
    dto,
    metaTop,
  );
  const gridTop = metaBottom - 8;
  drawRule(page, FRAME_LEFT, gridTop, FRAME_RIGHT, gridTop);

  const rows: GridCell[][] = [
    compactGridRow([
      {
        label: 'Vessel / Voyage:',
        value: dto.vesselVoyage,
        colStart: 0,
        colEnd: 1,
      },
      scheduleGridCell('ETD:', dto.etd, 1, 2),
      scheduleGridCell('ETA:', dto.eta, 2, 3),
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
    ]),
    [
      {
        label: 'Date of Pickup:',
        value: formatPdfDateTime(dto.pickupDate) || undefined,
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
    compactGridRow([
      {
        label: 'Place of Drop-off:',
        value: dto.dropoffPlace,
        colStart: 0,
        colEnd: 1,
      },
      {
        label: 'Closing Time:',
        value: formatPdfDateTime(dto.closingTime) || undefined,
        colStart: 1,
        colEnd: 3,
      },
      siVgmGridCell(dto.siCutoff, dto.vgmCutoff, 3, 5),
      { label: 'Contact:', value: dto.contact, colStart: 5, colEnd: 6 },
    ]),
    [
      { label: 'Commodity:', value: dto.commodity, colStart: 0, colEnd: 1 },
      {
        label: 'Volume:',
        value: resolveBookingVolumeDisplay(dto),
        colStart: 1,
        colEnd: 3,
      },
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
    cursor = drawGridRow(page, regular, bold, heading, row, rowTop);
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
  // Outer verticals only around the data grid (not the borderless intro / terms).
  drawRule(page, FRAME_LEFT, gridTop, FRAME_LEFT, frameBottom);
  drawRule(page, FRAME_RIGHT, gridTop, FRAME_RIGHT, frameBottom);

  // Terms sit below the bordered grid (no decorative box). PIC stays in-grid via dto.pic.
  drawTermsAndConditions(pdf, page, regular, heading, frameBottom);
}

/** Numbered terms body as a single multiline string for measurement / draw. */
export function formatBookingConfirmationTermsBody(): string {
  return BOOKING_CONFIRMATION_TERMS.map(
    (line, index) => `${index + 1}. ${line}`,
  ).join('\n');
}

/**
 * Vertical space needed for the Terms heading + numbered list.
 * `itemWidth` is the wrap width for numbered items (may be narrower than the
 * heading line, which sits flush at DOC_LEFT_X).
 */
export function measureBookingConfirmationTermsHeight(
  regular: PDFFont,
  itemWidth: number,
): number {
  const headingH = SECTION_LABEL_SIZE * LINE_HEIGHT;
  const wrapWidth = Math.max(40, itemWidth);
  let bodyH = 0;
  BOOKING_CONFIRMATION_TERMS.forEach((line, index) => {
    const item = `${index + 1}. ${line}`;
    bodyH += measureTextHeight(
      item,
      regular,
      TERMS_TEXT_SIZE,
      wrapWidth,
      LINE_HEIGHT,
    );
    if (index < BOOKING_CONFIRMATION_TERMS.length - 1) {
      bodyH += TERMS_ITEM_GAP;
    }
  });
  return headingH + TERMS_HEADING_GAP + bodyH;
}

/** Absolute x for numbered term items (heading stays at DOC_LEFT_X). */
function termsItemX(): number {
  return DOC_LEFT_X + TERMS_LEFT_INSET + TERMS_ITEM_INDENT;
}

/** Wrap width for numbered term items (right inset applied). */
function termsItemWidth(): number {
  return Math.max(
    40,
    FRAME_RIGHT - FRAME_TEXT_INSET - TERMS_RIGHT_INSET - termsItemX(),
  );
}

/**
 * Draw Terms and Conditions below the grid when there is room; otherwise on a
 * continuation page (same overflow pattern as AN/DO attention bands).
 */
function drawTermsAndConditions(
  pdf: PDFDocument,
  page: PDFPage,
  regular: PDFFont,
  heading: PDFFont,
  gridBottom: number,
): void {
  const headingX = DOC_LEFT_X;
  const itemX = termsItemX();
  const itemWidth = termsItemWidth();
  const needed = measureBookingConfirmationTermsHeight(regular, itemWidth);
  const topOnPage1 = gridBottom - TERMS_GAP;

  if (topOnPage1 - needed >= PAGE_MIN_BOTTOM) {
    drawTermsBlock(
      page,
      regular,
      heading,
      topOnPage1,
      headingX,
      itemX,
      itemWidth,
    );
    return;
  }

  const cont = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  cont.drawText('BOOKING CONFIRMATION - TERMS AND CONDITIONS', {
    x: headingX,
    y: TERMS_CONTINUATION_TOP,
    size: DOC_CONTINUATION_TITLE_SIZE,
    font: heading,
    color: BLACK,
  });
  drawTermsBlock(
    cont,
    regular,
    heading,
    TERMS_CONTINUATION_TOP - (DOC_CONTINUATION_TITLE_SIZE + 12),
    headingX,
    itemX,
    itemWidth,
  );
}

function drawTermsBlock(
  page: PDFPage,
  regular: PDFFont,
  heading: PDFFont,
  top: number,
  headingX: number,
  itemX: number,
  itemWidth: number,
): void {
  const termsHeading = 'Terms and Conditions:';
  page.drawText(termsHeading, {
    x: headingX,
    y: top - SECTION_LABEL_SIZE,
    size: SECTION_LABEL_SIZE,
    font: heading,
    color: BLACK,
  });

  let cursor = top - SECTION_LABEL_SIZE * LINE_HEIGHT - TERMS_HEADING_GAP;

  BOOKING_CONFIRMATION_TERMS.forEach((line, index) => {
    const item = `${index + 1}. ${line}`;
    cursor = drawTextBlock(page, regular, regular, item, {
      x: itemX,
      top: cursor,
      width: itemWidth,
      size: TERMS_TEXT_SIZE,
      lineHeightFactor: LINE_HEIGHT,
    });
    if (index < BOOKING_CONFIRMATION_TERMS.length - 1) {
      cursor -= TERMS_ITEM_GAP;
    }
  });
}

/**
 * Sample layout: Date / Booking No. stacked & right-aligned on the first band
 * (no column borders). To + intro start on the next band below that, full left width.
 */
function drawBorderlessIntro(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  heading: PDFFont,
  dto: BookingConfirmationPreviewDto,
  top: number,
): number {
  const rightBlockWidth = 200;
  const rightX = FRAME_RIGHT - FRAME_TEXT_INSET - rightBlockWidth;

  // Band 1 — Date then Booking No. only (right-aligned).
  // Labels = DejaVu Bold; values = Arial Bold (same emphasis as To name).
  let rightCursor = top;
  rightCursor = drawRightAlignedLabeledLine(
    page,
    bold,
    heading,
    'Date:',
    formatPdfDateTime(dto.date) || dto.date,
    rightX,
    rightBlockWidth,
    rightCursor,
  );
  rightCursor = drawRightAlignedLabeledLine(
    page,
    bold,
    heading,
    'Booking No.:',
    dto.bookingNumber,
    rightX,
    rightBlockWidth,
    rightCursor - 4,
  );

  // Band 2 — To + intro on the next rows (below Date / Booking No.).
  // "To:" = DejaVu Bold; client name = Arial Bold; same size + shared baseline.
  const toTop = rightCursor - 10;
  const toLabel = 'To:';
  const toName = partyDisplayName(dto.to);
  const toWidth = FRAME_RIGHT - FRAME_TEXT_INSET - DOC_LEFT_X;
  const { baselineY, blockTop, size: toSize } =
    bookingConfirmationToLineLayout(toTop);
  page.drawText(toLabel, {
    x: DOC_LEFT_X,
    y: baselineY,
    size: toSize,
    font: heading,
    color: BLACK,
  });
  const toValueX = labelValueStartX(toLabel, DOC_LEFT_X, heading, toSize);
  const toValueWidth = Math.max(40, toWidth - (toValueX - DOC_LEFT_X));
  const toBottom = drawTextBlock(page, regular, bold, toName, {
    x: toValueX,
    top: blockTop,
    width: toValueWidth,
    minHeight: contentAwareHeight(
      measureTextHeight(toName, bold, toSize, toValueWidth, LINE_HEIGHT),
      EMPTY_TO_MIN,
    ),
    size: toSize,
    bold: true,
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

/**
 * Right-aligned "Label: value" line. Label uses DejaVu Bold (`heading`);
 * value uses the passed value font (Arial Bold for Date / Booking No.).
 */
function drawRightAlignedLabeledLine(
  page: PDFPage,
  valueFont: PDFFont,
  heading: PDFFont,
  label: string,
  value: string | undefined,
  blockX: number,
  blockWidth: number,
  top: number,
): number {
  const valueText = (value ?? '').trim();
  const labelWidth = heading.widthOfTextAtSize(label, SECTION_LABEL_SIZE);
  const gap = valueText ? 4 : 0;
  const valueWidth = valueText
    ? valueFont.widthOfTextAtSize(valueText, TEXT_SIZE)
    : 0;
  const totalWidth = labelWidth + gap + valueWidth;
  let x = blockX + Math.max(0, blockWidth - totalWidth);
  const y = top - Math.max(SECTION_LABEL_SIZE, TEXT_SIZE);
  page.drawText(label, {
    x,
    y,
    size: SECTION_LABEL_SIZE,
    font: heading,
    color: BLACK,
  });
  if (valueText) {
    x += labelWidth + gap;
    page.drawText(valueText, {
      x,
      y,
      size: TEXT_SIZE,
      font: valueFont,
      color: BLACK,
    });
  }
  return top - Math.max(SECTION_LABEL_SIZE, TEXT_SIZE) * LINE_HEIGHT;
}

function siVgmGridCell(
  siCutoff: string | undefined,
  vgmCutoff: string | undefined,
  colStart: number,
  colEnd: number,
): GridCell | null {
  const blocks = buildSiVgmCutoffBlocks(siCutoff, vgmCutoff);
  if (!blocks.length) return null;
  return {
    label: '',
    colStart,
    colEnd,
    stackedCutoff: blocks,
  };
}

/** Build SI/VGM stacked cutoff blocks (label only when value formats non-empty). */
export function buildSiVgmCutoffBlocks(
  siCutoff?: string,
  vgmCutoff?: string,
): StackedCutoffBlock[] {
  const blocks: StackedCutoffBlock[] = [];
  const si = formatPdfDateTime(siCutoff);
  const vgm = formatPdfDateTime(vgmCutoff);
  if (si) blocks.push({ label: 'SI Cut off', value: si });
  if (vgm) blocks.push({ label: 'VGM Cut off', value: vgm });
  return blocks;
}

/** Omit ETD/ETA cells when the schedule value is blank after formatting. */
function scheduleGridCell(
  label: string,
  value: string | undefined,
  colStart: number,
  colEnd: number,
): GridCell | null {
  const formatted = formatPdfDateTime(value);
  if (!formatted) return null;
  return { label, value: formatted, colStart, colEnd };
}

function compactGridRow(cells: Array<GridCell | null>): GridCell[] {
  return cells.filter((cell): cell is GridCell => cell != null);
}

const STACKED_CUTOFF_DIVIDER_GAP = 4;

function measureStackedCutoffHeight(
  blocks: StackedCutoffBlock[],
  regular: PDFFont,
  heading: PDFFont,
  width: number,
): number {
  let height = CELL_PAD * 2;
  blocks.forEach((block, index) => {
    if (index > 0) {
      height += STACKED_CUTOFF_DIVIDER_GAP * 2 + RULE_THICKNESS;
    }
    height += measureTextHeight(
      block.label,
      heading,
      GRID_LABEL_SIZE,
      width,
      LINE_HEIGHT,
    );
    height += LABEL_GAP;
    height += measureTextHeight(block.value, regular, TEXT_SIZE, width, LINE_HEIGHT);
  });
  return Math.max(height, 40);
}

function drawStackedCutoffCell(
  page: PDFPage,
  regular: PDFFont,
  heading: PDFFont,
  cell: GridCell,
  top: number,
): void {
  const blocks = cell.stackedCutoff ?? [];
  const x = COLS[cell.colStart] + CELL_PAD;
  const width = COLS[cell.colEnd] - COLS[cell.colStart] - CELL_PAD * 2;
  const ruleLeft = COLS[cell.colStart] + 2;
  const ruleRight = COLS[cell.colEnd] - 2;
  let cursor = top - CELL_PAD;

  blocks.forEach((block, index) => {
    if (index > 0) {
      cursor -= STACKED_CUTOFF_DIVIDER_GAP;
      drawRule(page, ruleLeft, cursor, ruleRight, cursor);
      cursor -= STACKED_CUTOFF_DIVIDER_GAP;
    }
    cursor = drawTextBlock(page, heading, heading, block.label, {
      x,
      top: cursor,
      width,
      size: GRID_LABEL_SIZE,
      bold: true,
      lineHeightFactor: LINE_HEIGHT,
    });
    cursor = drawTextBlock(page, regular, regular, block.value, {
      x,
      top: cursor - LABEL_GAP,
      width,
      size: TEXT_SIZE,
      lineHeightFactor: LINE_HEIGHT,
    });
  });
}

/**
 * Draw one grid row: DejaVu Bold labels above Arial values in each cell.
 * SI/VGM cells draw stacked labeled blocks with an internal divider.
 */
function drawGridRow(
  page: PDFPage,
  regular: PDFFont,
  _bold: PDFFont,
  heading: PDFFont,
  cells: GridCell[],
  top: number,
): number {
  const heights = cells.map((cell) => {
    const width = COLS[cell.colEnd] - COLS[cell.colStart] - CELL_PAD * 2;
    if (cell.stackedCutoff?.length) {
      return measureStackedCutoffHeight(
        cell.stackedCutoff,
        regular,
        heading,
        width,
      );
    }
    const labelH = measureTextHeight(
      cell.label,
      heading,
      GRID_LABEL_SIZE,
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
    if (cell.stackedCutoff?.length) {
      drawStackedCutoffCell(page, regular, heading, cell, top);
      continue;
    }
    const x = COLS[cell.colStart] + CELL_PAD;
    const width = COLS[cell.colEnd] - COLS[cell.colStart] - CELL_PAD * 2;
    const labelBottom = drawTextBlock(page, heading, heading, cell.label, {
      x,
      top: top - CELL_PAD,
      width,
      size: GRID_LABEL_SIZE,
      bold: true,
      lineHeightFactor: LINE_HEIGHT,
    });
    drawTextBlock(page, regular, regular, cell.value, {
      x,
      top: labelBottom - LABEL_GAP,
      width,
      size: TEXT_SIZE,
      lineHeightFactor: LINE_HEIGHT,
    });
  }

  return bottom;
}
