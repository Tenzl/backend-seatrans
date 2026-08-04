import { PDFFont, PDFImage, PDFPage, PDFDocument, rgb } from 'pdf-lib';
import { CargoRowDto } from '../dto/cargo-row.dto';

export interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
  size?: number;
  /** Ignored: text shrinks to fit the box instead of truncating with "...". */
  maxLines?: number;
  bold?: boolean;
  color?: ReturnType<typeof rgb>;
}

const PAGE_WIDTH = 595.276;
const PAGE_HEIGHT = 841.89;
export const BLACK = rgb(0, 0, 0);

/** Single stroke weight for all form rules (boxes, tables, dividers). */
export const RULE_THICKNESS = 0.5;

/** Horizontal inset from frame / cell vertical rules. */
export const FRAME_TEXT_INSET = 5;

/**
 * Vertical breathing room inside labeled cells / section blocks (AN, DO, BC).
 * Same value as FRAME_TEXT_INSET so grid cells and labeled blocks match.
 */
export const DOC_CELL_PAD = FRAME_TEXT_INSET;

/** Gap between a label (including its colon) and the value start. */
export const LABEL_VALUE_GAP = 6;

/** Shared outer frame for AN / DO / Booking Confirmation body chrome. */
export const DOC_FRAME_LEFT = 6;
export const DOC_FRAME_MID = 297;
export const DOC_FRAME_RIGHT = 589.7;

/** Top meta-header band (Agent/Date/Doc No. style cells). */
export const DOC_HEADER_TOP = 698;
export const DOC_HEADER_BOTTOM = 676;
export const DOC_HEADER_DATE_DIV = 443;
export const DOC_HEADER_LABEL_Y = 681;
export const DOC_HEADER_VALUE_Y = 680;
export const DOC_HEADER_VALUE_H = 10;

/**
 * Shared typography / rhythm for AN, DO, and Booking Confirmation.
 *   DOC_SECTION_LABEL_SIZE — bold section titles (To, Shipper, Marks, Volume, …)
 *   DETAIL_LABEL_SIZE      — bold right-column field labels (MBL No., Vessel/Voyage, …)
 *   DOC_BODY_TEXT_SIZE     — all form body / value text (left blocks + right values)
 * DETAIL_LABEL_SIZE aliases DOC_SECTION_LABEL_SIZE so labels stay one family.
 */
export const DOC_SECTION_LABEL_SIZE = 8;
export const DOC_BODY_TEXT_SIZE = 8;
export const DOC_SECTION_GAP = 6;
export const DOC_LABEL_GAP = 3;

/**
 * Height for a value box: grow with measured content; keep emptyMin only when blank.
 * Avoids large empty-form reservations when text is present.
 */
export function contentAwareHeight(
  contentHeight: number,
  emptyMinHeight: number,
): number {
  return contentHeight > 0 ? contentHeight : emptyMinHeight;
}

/**
 * Full vertical extent of a label-above-value stack (BC grid cells + AN/DO blocks):
 * topPad + label + gap + value + bottomPad.
 */
export function labeledBlockStackHeight(
  labelHeight: number,
  valueHeight: number,
): number {
  return (
    DOC_CELL_PAD + labelHeight + DOC_LABEL_GAP + valueHeight + DOC_CELL_PAD
  );
}

export const DOC_LEFT_X = DOC_FRAME_LEFT + FRAME_TEXT_INSET;
export const DOC_RIGHT_X = DOC_FRAME_MID + FRAME_TEXT_INSET;
export const DOC_LEFT_W = DOC_FRAME_MID - FRAME_TEXT_INSET - DOC_LEFT_X;
export const DOC_RIGHT_W = DOC_FRAME_RIGHT - FRAME_TEXT_INSET - DOC_RIGHT_X;

/**
 * Right-column detail labels (MBL No., Vessel/Voyage, …) — bold, same scale
 * as section labels / body so AN + DO stay visually uniform.
 * Values always render at DOC_BODY_TEXT_SIZE via drawLabelValueLine.
 */
export const DETAIL_LABEL_SIZE = DOC_SECTION_LABEL_SIZE;
export const DETAIL_ROW_STEP = 14;

/**
 * First label baseline below a horizontal section rule at Y.
 * Matches historic `rule at y+4` then `y -= 6` → first label at ruleY - 10.
 */
export const BELOW_RULE_BASELINE = 10;

export type MetaHeaderCell = { label: string; value?: string };

/**
 * Draw the shared 3-cell meta header: left | Date mid | doc-no right.
 * Values use fixed DOC_BODY_TEXT_SIZE (no shrink). Row grows with wrapped text.
 * Returns the header bottom Y so callers can continue the body below it.
 */
export function drawMetaHeaderRow(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  cells: {
    left?: MetaHeaderCell;
    mid: MetaHeaderCell;
    right: MetaHeaderCell;
  },
  options?: { drawOuterVerticals?: boolean },
): number {
  const headerTop = DOC_HEADER_TOP;
  const pad = DOC_CELL_PAD;
  const labelSize = DOC_SECTION_LABEL_SIZE;
  const specs: Array<{
    cell?: MetaHeaderCell;
    labelX: number;
    valueRight: number;
  }> = [
    {
      cell: cells.left,
      labelX: DOC_LEFT_X,
      valueRight: DOC_FRAME_MID - FRAME_TEXT_INSET,
    },
    {
      cell: cells.mid,
      labelX: DOC_FRAME_MID + FRAME_TEXT_INSET,
      valueRight: DOC_HEADER_DATE_DIV - FRAME_TEXT_INSET,
    },
    {
      cell: cells.right,
      labelX: DOC_HEADER_DATE_DIV + FRAME_TEXT_INSET,
      valueRight: DOC_FRAME_RIGHT - FRAME_TEXT_INSET,
    },
  ];

  let deepest = DOC_HEADER_BOTTOM;
  for (const { cell, labelX, valueRight } of specs) {
    if (!cell) continue;
    const labelY = headerTop - pad - labelSize;
    page.drawText(cell.label, {
      x: labelX,
      y: labelY,
      size: labelSize,
      font: bold,
      color: BLACK,
    });
    const valueX = labelValueStartX(cell.label, labelX, bold, labelSize);
    const valueWidth = Math.max(20, valueRight - valueX);
    const valueBottom = drawTextBlock(page, regular, bold, cell.value, {
      x: valueX,
      top: headerTop - pad,
      width: valueWidth,
      size: DOC_BODY_TEXT_SIZE,
    });
    const cellBottom = (cell.value?.trim() ? valueBottom : labelY) - pad;
    deepest = Math.min(deepest, cellBottom);
  }

  const headerBottom = Math.min(deepest, DOC_HEADER_BOTTOM);

  drawRule(page, DOC_FRAME_LEFT, headerTop, DOC_FRAME_RIGHT, headerTop);
  drawRule(page, DOC_FRAME_LEFT, headerBottom, DOC_FRAME_RIGHT, headerBottom);
  drawRule(page, DOC_FRAME_MID, headerTop, DOC_FRAME_MID, headerBottom);
  drawRule(
    page,
    DOC_HEADER_DATE_DIV,
    headerTop,
    DOC_HEADER_DATE_DIV,
    headerBottom,
  );
  if (options?.drawOuterVerticals !== false) {
    drawRule(page, DOC_FRAME_LEFT, headerTop, DOC_FRAME_LEFT, headerBottom);
    drawRule(page, DOC_FRAME_RIGHT, headerTop, DOC_FRAME_RIGHT, headerBottom);
  }
  return headerBottom;
}

/** Bold section label + wrapped body value block (Shipper / Consignee style). */
export function drawLabeledBlock(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  opts: {
    label: string;
    labelY: number;
    value: string | undefined;
    x: number;
    top: number;
    width: number;
    /** Empty-form reservation only; ignored when value has content. */
    minHeight: number;
    labelSize?: number;
    valueSize?: number;
  },
): number {
  const labelSize = opts.labelSize ?? DOC_SECTION_LABEL_SIZE;
  const valueSize = opts.valueSize ?? DOC_BODY_TEXT_SIZE;
  // labelY is the first-line baseline; drawTextBlock uses a box top.
  const labelBottom = drawTextBlock(page, regular, bold, opts.label, {
    x: opts.x,
    top: opts.labelY + labelSize,
    width: opts.width,
    size: labelSize,
    bold: true,
  });
  // Tight under label by default. Push down only when the label wraps below opts.top.
  // If opts.top leaves a large empty gap under a short label, collapse it.
  const tightTop = labelBottom;
  const valueTop =
    opts.top < tightTop - DOC_LABEL_GAP * 2
      ? tightTop
      : Math.min(opts.top, tightTop);
  const contentH = measureTextHeight(
    opts.value,
    regular,
    valueSize,
    opts.width,
  );
  const contentBottom = drawTextBlock(page, regular, bold, opts.value, {
    x: opts.x,
    top: valueTop,
    width: opts.width,
    minHeight: contentAwareHeight(contentH, opts.minHeight),
    size: valueSize,
  });
  // Match BC cell bottom inset so the divider sits below content + pad.
  return contentBottom - DOC_CELL_PAD;
}

/**
 * Side-by-side labeled blocks (Notify/Note, Marks/Volume).
 * Same vertical rhythm as BC grid cells:
 *   DOC_CELL_PAD + label + DOC_LABEL_GAP + body + DOC_CELL_PAD
 * Draws the mid-column vertical from sectionTop down to the pair bottom so
 * every stacked pair (Notify/Note AND Marks/Volume) gets a continuous divider.
 * Returns the bottom Y of the pair (rule / next-section anchor).
 */
export function drawPairedLabeledBlocks(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  left: { label: string; value?: string; x: number; width: number },
  right: { label: string; value?: string; x: number; width: number },
  opts: {
    /** Top of section (usually the divider Y above the labels). */
    sectionTop: number;
    emptyMinHeight: number;
    labelSize?: number;
    valueSize?: number;
  },
): number {
  const labelSize = opts.labelSize ?? DOC_SECTION_LABEL_SIZE;
  const valueSize = opts.valueSize ?? DOC_BODY_TEXT_SIZE;
  const pad = DOC_CELL_PAD;
  const labelTop = opts.sectionTop - pad;

  const leftLabelBottom = drawTextBlock(page, regular, bold, left.label, {
    x: left.x,
    top: labelTop,
    width: left.width,
    size: labelSize,
    bold: true,
  });
  const rightLabelBottom = drawTextBlock(page, regular, bold, right.label, {
    x: right.x,
    top: labelTop,
    width: right.width,
    size: labelSize,
    bold: true,
  });
  const valueTop = Math.min(leftLabelBottom, rightLabelBottom) - DOC_LABEL_GAP;

  const contentH = Math.max(
    measureTextHeight(left.value, regular, valueSize, left.width),
    measureTextHeight(right.value, regular, valueSize, right.width),
  );
  const height = contentAwareHeight(contentH, opts.emptyMinHeight);

  drawTextBlock(page, regular, bold, left.value, {
    x: left.x,
    top: valueTop,
    width: left.width,
    minHeight: height,
    size: valueSize,
  });
  drawTextBlock(page, regular, bold, right.value, {
    x: right.x,
    top: valueTop,
    width: right.width,
    minHeight: height,
    size: valueSize,
  });

  const sectionBottom = valueTop - height - pad;
  // Mid divider for this pair only (Notify/Note, Marks/Volume, …).
  drawRule(page, DOC_FRAME_MID, opts.sectionTop, DOC_FRAME_MID, sectionBottom);
  return sectionBottom;
}

/** Pick the lower edge so left/right section dividers share one Y. */
export function syncDividerY(...candidates: number[]): number {
  return Math.min(...candidates);
}

export type LabelValuePair = [string, string | undefined];

/** Align a value column after the widest label in the set. */
export function columnValueLayout(
  labelX: number,
  valueRight: number,
  labels: string[],
  font: PDFFont,
  size: number = DETAIL_LABEL_SIZE,
): { valueX: number; valueWidth: number } {
  const valueX = labelX + maxLabelWidth(labels, font, size) + LABEL_VALUE_GAP;
  return { valueX, valueWidth: Math.max(40, valueRight - valueX) };
}

/** Draw stacked label/value rows; returns Y for the next row. */
export function drawLabelValueRows(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  rows: LabelValuePair[],
  opts: {
    labelX: number;
    valueX: number;
    valueWidth: number;
    y: number;
    /** Bold label size; defaults to DETAIL_LABEL_SIZE. */
    labelSize?: number;
    /** Body/value size; defaults to DOC_BODY_TEXT_SIZE. */
    valueSize?: number;
    minRowStep?: number;
  },
): number {
  let y = opts.y;
  const labelSize = opts.labelSize ?? DETAIL_LABEL_SIZE;
  const valueSize = opts.valueSize ?? DOC_BODY_TEXT_SIZE;
  const minRowStep = opts.minRowStep ?? DETAIL_ROW_STEP;
  for (const [label, value] of rows) {
    y = drawLabelValueLine(page, regular, bold, {
      label,
      value,
      labelX: opts.labelX,
      valueX: opts.valueX,
      valueWidth: opts.valueWidth,
      y,
      labelSize,
      valueSize,
      minRowStep,
    });
  }
  return y;
}

/** Widest label width at the given font size (for aligning a value column). */
export function maxLabelWidth(
  labels: string[],
  font: PDFFont,
  size: number,
): number {
  return labels.reduce(
    (max, label) => Math.max(max, font.widthOfTextAtSize(label, size)),
    0,
  );
}

/** X where a value should start after `label` drawn at `labelX`. */
export function labelValueStartX(
  label: string,
  labelX: number,
  font: PDFFont,
  size: number,
  gap: number = LABEL_VALUE_GAP,
): number {
  return labelX + font.widthOfTextAtSize(label, size) + gap;
}

/**
 * Draw a bold label and wrapped regular value sharing a baseline.
 * Label and value sizes are independent so detail labels can stay bold
 * without forcing body text off DOC_BODY_TEXT_SIZE.
 * Returns the Y for the next row (clears multi-line values).
 */
export function drawLabelValueLine(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  opts: {
    label: string;
    value?: string;
    labelX: number;
    valueX: number;
    valueWidth: number;
    y: number;
    labelSize: number;
    valueSize: number;
    minRowStep: number;
  },
): number {
  page.drawText(opts.label, {
    x: opts.labelX,
    y: opts.y,
    size: opts.labelSize,
    font: bold,
    color: BLACK,
  });
  if (!opts.value?.trim()) {
    return opts.y - opts.minRowStep;
  }
  const bottom = drawTextBlock(page, regular, bold, opts.value, {
    x: opts.valueX,
    top: opts.y + opts.valueSize,
    width: opts.valueWidth,
    size: opts.valueSize,
  });
  const used = opts.y + opts.valueSize - bottom;
  // Extra 2pt keeps the next label clear of glyph descent on the last line.
  return opts.y - Math.max(opts.minRowStep, used + 2);
}

export function drawRule(
  page: PDFPage,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness: RULE_THICKNESS,
    color: BLACK,
  });
}

export function drawLetterhead(
  page: PDFPage,
  image: PDFImage,
  bold: PDFFont,
  title: string,
  options: { clearBottom: number; titleY: number },
): void {
  page.drawRectangle({
    x: 0,
    y: options.clearBottom,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT - options.clearBottom,
    color: rgb(1, 1, 1),
  });

  const width = 565;
  const height = width / (image.width / image.height);
  page.drawImage(image, {
    x: (PAGE_WIDTH - width) / 2,
    y: PAGE_HEIGHT - height - 1,
    width,
    height,
  });

  const titleSize = title.length > 22 ? 22 : 25;
  page.drawText(title, {
    x: (PAGE_WIDTH - bold.widthOfTextAtSize(title, titleSize)) / 2,
    y: options.titleY,
    size: titleSize,
    font: bold,
    color: BLACK,
  });
  drawRule(page, 6, options.clearBottom, PAGE_WIDTH - 6, options.clearBottom);
}

const DEFAULT_CARGO_COLUMNS = [6, 179, 267, 412, 500, 589];
const CARGO_HEADERS = [
  'Container No./ Seal No.',
  'Quantity',
  'Description of Goods',
  'Gross Weight',
  'Measurement',
] as const;

export function drawCargoRows(
  page: PDFPage,
  rows: CargoRowDto[],
  regular: PDFFont,
  bold: PDFFont,
  area: {
    top: number;
    /** Fixed-band bottom (equal row heights). Ignored when minRowHeight is set. */
    bottom?: number;
    /** Expandable mode: stop placing rows before this Y. */
    minBottom?: number;
    maxRows: number;
    /** Column x edges (left → right). */
    columns?: number[];
    /**
     * When set, draws one complete table (header + body) in this band.
     * Template cargo chrome under the band should be cleared first.
     */
    headerHeight?: number;
    /** When set, row heights grow with cell content (fixed font, no shrink). */
    minRowHeight?: number;
    fontSize?: number;
  },
): { remaining: CargoRowDto[]; bottom: number } {
  const columns = area.columns ?? DEFAULT_CARGO_COLUMNS;
  const left = columns[0];
  const right = columns[columns.length - 1];
  const headerHeight = area.headerHeight ?? 0;
  const bodyTop = area.top - headerHeight;
  const fontSize = area.fontSize ?? DOC_BODY_TEXT_SIZE;
  const headerSize = DOC_SECTION_LABEL_SIZE;
  const cellPadX = 4;
  const cellPadY = 5;
  const cellInner = cellPadX * 2;

  if (headerHeight > 0) {
    drawRule(page, left, area.top, right, area.top);
    drawRule(page, left, bodyTop, right, bodyTop);
    CARGO_HEADERS.forEach((header, column) => {
      page.drawText(header, {
        x: columns[column] + cellPadX,
        y: bodyTop + (headerHeight - headerSize) / 2,
        size: headerSize,
        font: bold,
        color: BLACK,
      });
    });
  }

  if (area.minRowHeight != null) {
    const minBottom = area.minBottom ?? 40;
    const shown: CargoRowDto[] = [];
    const rowHeights: number[] = [];
    let cursor = bodyTop;

    for (const row of rows) {
      if (shown.length >= area.maxRows) break;
      const values = cargoValues(row);
      let contentH = 0;
      values.forEach((value, column) => {
        const width = columns[column + 1] - columns[column] - cellInner;
        contentH = Math.max(
          contentH,
          measureTextHeight(value, regular, fontSize, width),
        );
      });
      const rowHeight = Math.max(area.minRowHeight, contentH + cellPadY);
      if (cursor - rowHeight < minBottom) break;
      shown.push(row);
      rowHeights.push(rowHeight);
      cursor -= rowHeight;
    }

    const tableBottom = cursor;
    drawRule(page, left, tableBottom, right, tableBottom);
    let y = bodyTop;
    for (let index = 0; index < shown.length; index += 1) {
      y -= rowHeights[index];
      if (index < shown.length - 1) {
        drawRule(page, left, y, right, y);
      }
    }
    columns.forEach((x) => drawRule(page, x, tableBottom, x, area.top));

    let rowTop = bodyTop;
    shown.forEach((row, index) => {
      const rowHeight = rowHeights[index];
      const rowBottom = rowTop - rowHeight;
      cargoValues(row).forEach((value, column) => {
        drawTextBlock(page, regular, bold, value, {
          x: columns[column] + cellPadX,
          top: rowTop - cellPadY / 2,
          width: columns[column + 1] - columns[column] - cellInner,
          size: fontSize,
        });
      });
      rowTop = rowBottom;
    });

    return {
      remaining: rows.slice(shown.length),
      bottom: tableBottom,
    };
  }

  const bottom = area.bottom ?? bodyTop - area.maxRows * 22;
  const rowHeight = (bodyTop - bottom) / Math.max(area.maxRows, 1);
  const shown = rows.slice(0, area.maxRows);

  for (let index = 0; index <= area.maxRows; index += 1) {
    const y = bodyTop - rowHeight * index;
    drawRule(page, left, y, right, y);
  }
  columns.forEach((x) => drawRule(page, x, bottom, x, area.top));

  shown.forEach((row, index) => {
    const y = bodyTop - rowHeight * (index + 1) + cellPadY / 2;
    const height = rowHeight - cellPadY;
    cargoValues(row).forEach((value, column) =>
      drawText(page, regular, bold, value, {
        x: columns[column] + cellPadX,
        y,
        width: columns[column + 1] - columns[column] - cellInner,
        height,
        size: fontSize,
        maxLines: 2,
      }),
    );
  });
  return { remaining: rows.slice(area.maxRows), bottom };
}

function cargoValues(row: CargoRowDto): Array<string | undefined> {
  return [
    row.containerSealNumber,
    row.quantity,
    row.descriptionOfGoods,
    row.grossWeight,
    row.measurement,
  ];
}

export type AttentionBandOptions = {
  text?: string;
  includeForSeatrans?: boolean;
  /** Manager stamp drawn in the For SEATRANS block (DO). */
  managerStamp?: PDFImage;
  emptyMinHeight?: number;
  width?: number;
};

/** Stamp size inside the For SEATRANS / Manager column. */
const SEATRANS_STAMP_HEIGHT = 70;

/** Extra height for For SEATRANS title + stamp + Receiver/Manager labels. */
export function measureForSeatransBlockHeight(): number {
  return (
    DOC_LABEL_GAP +
    DOC_SECTION_LABEL_SIZE +
    DOC_LABEL_GAP +
    SEATRANS_STAMP_HEIGHT +
    DOC_LABEL_GAP +
    DOC_SECTION_LABEL_SIZE +
    DOC_CELL_PAD
  );
}

/** Vertical space needed for the attention (+ optional For SEATRANS) band. */
export function measureAttentionBandHeight(
  regular: PDFFont,
  options: AttentionBandOptions = {},
): number {
  const x = DOC_FRAME_LEFT + FRAME_TEXT_INSET;
  const width = options.width ?? DOC_FRAME_RIGHT - FRAME_TEXT_INSET - x;
  const bodyH = contentAwareHeight(
    measureTextHeight(options.text, regular, DOC_BODY_TEXT_SIZE, width),
    options.emptyMinHeight ?? 0,
  );
  let height =
    DOC_CELL_PAD +
    DOC_SECTION_LABEL_SIZE +
    DOC_LABEL_GAP +
    bodyH +
    DOC_CELL_PAD;
  if (options.includeForSeatrans) {
    height += measureForSeatransBlockHeight();
  }
  return height;
}

/**
 * Draw "For SEATRANS" with Receiver Signature (left) and Manager stamp (right).
 * Returns Y below the Receiver/Manager labels.
 */
export function drawForSeatransBlock(
  page: PDFPage,
  bold: PDFFont,
  options: {
    top: number;
    pageFloor?: number;
    managerStamp?: PDFImage;
  },
): number {
  const pageFloor = options.pageFloor ?? 48;
  const x = DOC_FRAME_LEFT + FRAME_TEXT_INSET;
  const right = DOC_FRAME_RIGHT - FRAME_TEXT_INSET;
  const labelSize = DOC_SECTION_LABEL_SIZE;
  const gap = DOC_LABEL_GAP;

  const titleY = options.top - gap - labelSize;
  page.drawText('For SEATRANS', {
    x,
    y: Math.max(pageFloor + labelSize, titleY),
    size: labelSize,
    font: bold,
    color: BLACK,
  });

  const stampTop = titleY - gap;
  let stampH = SEATRANS_STAMP_HEIGHT;
  let stampW = stampH * 1.35;
  let stampX = right - stampW;
  let stampY = stampTop - stampH;

  if (options.managerStamp) {
    const img = options.managerStamp;
    stampW = stampH * (img.width / Math.max(img.height, 1));
    stampX = right - stampW;
    stampY = stampTop - stampH;
    // Keep stamp above page floor with room for "Manager" label.
    const minStampY = pageFloor + gap + labelSize + DOC_CELL_PAD;
    if (stampY < minStampY) {
      const overflow = minStampY - stampY;
      stampH = Math.max(36, stampH - overflow);
      stampW = stampH * (img.width / Math.max(img.height, 1));
      stampX = right - stampW;
      stampY = stampTop - stampH;
    }
    page.drawImage(img, {
      x: stampX,
      y: Math.max(minStampY, stampY),
      width: stampW,
      height: stampH,
    });
    stampY = Math.max(minStampY, stampY);
  }

  const labelY = Math.max(pageFloor + DOC_CELL_PAD, stampY - gap - labelSize);
  const receiver = 'Receiver Signature';
  const manager = 'Manager';
  // Receiver sits in the left half; Manager centered under the stamp.
  page.drawText(receiver, {
    x: x + 40,
    y: labelY,
    size: labelSize,
    font: bold,
    color: BLACK,
  });
  const managerWidth = bold.widthOfTextAtSize(manager, labelSize);
  page.drawText(manager, {
    x: stampX + (stampW - managerWidth) / 2,
    y: labelY,
    size: labelSize,
    font: bold,
    color: BLACK,
  });

  return labelY - DOC_CELL_PAD;
}

/**
 * Draw "For customer's attention" (+ optional "For SEATRANS") below `top`.
 * Returns the Y of the band bottom (after bottom pad).
 */
export function drawAttentionBand(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  options: AttentionBandOptions & {
    top: number;
    pageFloor?: number;
    drawFrame?: boolean;
  },
): number {
  const pageFloor = options.pageFloor ?? 48;
  const x = DOC_FRAME_LEFT + FRAME_TEXT_INSET;
  const width = options.width ?? DOC_FRAME_RIGHT - FRAME_TEXT_INSET - x;
  const pad = DOC_CELL_PAD;

  const labelY = options.top - pad - DOC_SECTION_LABEL_SIZE;
  page.drawText("For customer's attention:", {
    x,
    y: labelY,
    size: DOC_SECTION_LABEL_SIZE,
    font: bold,
    color: BLACK,
  });

  const bodyTop = labelY - DOC_LABEL_GAP;
  const bodyMin = contentAwareHeight(
    measureTextHeight(options.text, regular, DOC_BODY_TEXT_SIZE, width),
    options.emptyMinHeight ?? 0,
  );
  const attentionBottom = drawTextBlock(page, regular, bold, options.text, {
    x,
    top: bodyTop,
    width,
    minHeight: bodyMin,
    size: DOC_BODY_TEXT_SIZE,
  });

  let bottom = attentionBottom - pad;
  if (options.includeForSeatrans) {
    bottom = drawForSeatransBlock(page, bold, {
      top: attentionBottom - pad,
      pageFloor,
      managerStamp: options.managerStamp,
    });
  }

  if (options.drawFrame !== false) {
    drawRule(page, DOC_FRAME_LEFT, options.top, DOC_FRAME_RIGHT, options.top);
    drawRule(page, DOC_FRAME_LEFT, pageFloor, DOC_FRAME_RIGHT, pageFloor);
    drawRule(page, DOC_FRAME_LEFT, options.top, DOC_FRAME_LEFT, pageFloor);
    drawRule(page, DOC_FRAME_RIGHT, options.top, DOC_FRAME_RIGHT, pageFloor);
  }

  return bottom;
}

export type CargoContinuationOptions = {
  /**
   * Drawn once after the last cargo table on the last continuation page
   * (Container table first, then attention / For SEATRANS).
   */
  attentionAfterCargo?: AttentionBandOptions;
};

export function addCargoContinuationPages(
  pdf: PDFDocument,
  rows: CargoRowDto[],
  regular: PDFFont,
  bold: PDFFont,
  title: string,
  options?: CargoContinuationOptions,
): void {
  let remaining = rows;
  const attentionAfter = options?.attentionAfterCargo;
  const contPageFloor = 40;

  // Attention-only page when there is no cargo left to draw.
  if (remaining.length === 0 && attentionAfter) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawText(`${title} - CARGO CONTINUATION`, {
      x: 28,
      y: 790,
      size: 17,
      font: bold,
      color: BLACK,
    });
    drawAttentionBand(page, regular, bold, {
      ...attentionAfter,
      top: 760,
      pageFloor: contPageFloor,
      drawFrame: false,
    });
    return;
  }

  while (remaining.length > 0) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawText(`${title} - CARGO CONTINUATION`, {
      x: 28,
      y: 790,
      size: 17,
      font: bold,
      color: BLACK,
    });
    const columns = [28, 190, 278, 430, 505, 568];
    const headerTop = 760;
    const headerHeight = 20;
    const bodyTop = headerTop - headerHeight;
    const fontSize = DOC_BODY_TEXT_SIZE;
    const headerSize = DOC_SECTION_LABEL_SIZE;
    const cellPad = 6;
    const minRowHeight = 30;

    const needed = attentionAfter
      ? measureAttentionBandHeight(regular, attentionAfter)
      : 0;
    const minBottom = contPageFloor;

    CARGO_HEADERS.forEach((header, index) =>
      page.drawText(header, {
        x: columns[index] + 3,
        y: bodyTop + (headerHeight - headerSize) / 2,
        size: headerSize,
        font: bold,
        color: BLACK,
      }),
    );
    drawRule(
      page,
      columns[0],
      headerTop,
      columns[columns.length - 1],
      headerTop,
    );
    drawRule(page, columns[0], bodyTop, columns[columns.length - 1], bodyTop);

    const batch: CargoRowDto[] = [];
    const rowHeights: number[] = [];
    let cursor = bodyTop;
    for (const row of remaining) {
      if (batch.length >= 14) break;
      const values = cargoValues(row);
      let contentH = 0;
      values.forEach((value, column) => {
        const width = columns[column + 1] - columns[column] - 6;
        contentH = Math.max(
          contentH,
          measureTextHeight(value, regular, fontSize, width),
        );
      });
      const rowHeight = Math.max(minRowHeight, contentH + cellPad);
      if (cursor - rowHeight < minBottom) break;
      batch.push(row);
      rowHeights.push(rowHeight);
      cursor -= rowHeight;
    }

    if (batch.length === 0) {
      // Row taller than available body — force one row without attention reserve.
      const row = remaining[0];
      const values = cargoValues(row);
      let contentH = 0;
      values.forEach((value, column) => {
        const width = columns[column + 1] - columns[column] - 6;
        contentH = Math.max(
          contentH,
          measureTextHeight(value, regular, fontSize, width),
        );
      });
      batch.push(row);
      rowHeights.push(Math.max(minRowHeight, contentH + cellPad));
      cursor = bodyTop - rowHeights[0];
    }

    const tableBottom = cursor;
    drawRule(
      page,
      columns[0],
      tableBottom,
      columns[columns.length - 1],
      tableBottom,
    );
    let y = bodyTop;
    for (let index = 0; index < batch.length - 1; index += 1) {
      y -= rowHeights[index];
      drawRule(page, columns[0], y, columns[columns.length - 1], y);
    }
    columns.forEach((x) => drawRule(page, x, tableBottom, x, headerTop));

    let rowTop = bodyTop;
    batch.forEach((row, rowIndex) => {
      const rowHeight = rowHeights[rowIndex];
      cargoValues(row).forEach((value, columnIndex) => {
        drawTextBlock(page, regular, bold, value, {
          x: columns[columnIndex] + 3,
          top: rowTop - 3,
          width: columns[columnIndex + 1] - columns[columnIndex] - 6,
          size: fontSize,
        });
      });
      rowTop -= rowHeight;
    });

    remaining = remaining.slice(batch.length);

    // Attention only after the final container table — never above cargo.
    if (remaining.length === 0 && attentionAfter) {
      if (tableBottom - needed >= contPageFloor) {
        drawAttentionBand(page, regular, bold, {
          ...attentionAfter,
          top: tableBottom,
          pageFloor: contPageFloor,
          drawFrame: false,
        });
      } else {
        const attnPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        attnPage.drawText(`${title} - CARGO CONTINUATION`, {
          x: 28,
          y: 790,
          size: 17,
          font: bold,
          color: BLACK,
        });
        drawAttentionBand(attnPage, regular, bold, {
          ...attentionAfter,
          top: 760,
          pageFloor: contPageFloor,
          drawFrame: false,
        });
      }
    }
  }
}

const DEFAULT_PAGE_CARGO_COLUMNS = [6, 180.6, 268.2, 414.1, 501.7, 589.7];

/**
 * Shared AN/DO page-end order:
 * Marks → Container cargo table → For customer's attention → (DO) For SEATRANS.
 * Attention never appears above / before the container table.
 */
export function finishCargoAndAttentionPage(
  pdf: PDFDocument,
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  opts: {
    marksBottom: number;
    cargoRows?: CargoRowDto[];
    title: string;
    attentionText?: string;
    includeForSeatrans?: boolean;
    managerStamp?: PDFImage;
    pageFloor?: number;
    cargoColumns?: number[];
    cargoHeaderHeight?: number;
    cargoMinRowHeight?: number;
    cargoMaxRows?: number;
    emptyAttentionMin?: number;
  },
): void {
  const pageFloor = opts.pageFloor ?? 48;
  const headerHeight = opts.cargoHeaderHeight ?? 18;
  const minRowHeight = opts.cargoMinRowHeight ?? 22;
  const maxRows = opts.cargoMaxRows ?? 4;
  const columns = opts.cargoColumns ?? DEFAULT_PAGE_CARGO_COLUMNS;
  const attentionOpts: AttentionBandOptions = {
    text: opts.attentionText,
    includeForSeatrans: opts.includeForSeatrans,
    managerStamp: opts.managerStamp,
    emptyMinHeight: opts.emptyAttentionMin ?? 0,
  };

  const needed = measureAttentionBandHeight(regular, attentionOpts);
  let remaining = opts.cargoRows ?? [];
  const anchorTop = opts.marksBottom;

  const cargoNeed = headerHeight + minRowHeight;
  const canFitCargo =
    remaining.length > 0 && opts.marksBottom - pageFloor >= cargoNeed;

  if (canFitCargo) {
    // Try cargo + attention on page 1 (reserve band under the table).
    const withRoom = drawCargoRows(page, remaining, regular, bold, {
      top: opts.marksBottom,
      minBottom: pageFloor + needed,
      maxRows,
      columns,
      headerHeight,
      minRowHeight,
      fontSize: DOC_BODY_TEXT_SIZE,
    });

    if (withRoom.remaining.length === 0) {
      drawAttentionBand(page, regular, bold, {
        ...attentionOpts,
        top: withRoom.bottom,
        pageFloor,
      });
      return;
    }

    // Overflow: wipe the partial table and refill page 1 with cargo only.
    page.drawRectangle({
      x: DOC_FRAME_LEFT - 0.5,
      y: pageFloor - 1,
      width: DOC_FRAME_RIGHT - DOC_FRAME_LEFT + 1,
      height: opts.marksBottom - pageFloor + 2,
      color: rgb(1, 1, 1),
    });
    const filled = drawCargoRows(page, remaining, regular, bold, {
      top: opts.marksBottom,
      minBottom: pageFloor,
      maxRows,
      columns,
      headerHeight,
      minRowHeight,
      fontSize: DOC_BODY_TEXT_SIZE,
    });
    remaining = filled.remaining;

    addCargoContinuationPages(pdf, remaining, regular, bold, opts.title, {
      attentionAfterCargo: attentionOpts,
    });
    return;
  }

  if (remaining.length > 0) {
    // No room for cargo on page 1 — all cargo (+ attention after it) on continuation.
    addCargoContinuationPages(pdf, remaining, regular, bold, opts.title, {
      attentionAfterCargo: attentionOpts,
    });
    return;
  }

  // No cargo: attention directly under Marks/Volume.
  if (anchorTop - needed >= pageFloor) {
    drawAttentionBand(page, regular, bold, {
      ...attentionOpts,
      top: anchorTop,
      pageFloor,
    });
    return;
  }

  addCargoContinuationPages(pdf, [], regular, bold, opts.title, {
    attentionAfterCargo: attentionOpts,
  });
}

/**
 * Measured height of wrapped text at a fixed font size (no shrink / ellipsis).
 * Includes a small descent pad so section rules do not slice the last line.
 */
export function measureTextHeight(
  text: string | undefined,
  font: PDFFont,
  size: number,
  width: number,
  lineHeightFactor = 1.2,
): number {
  if (!text?.trim()) return 0;
  const lineHeight = size * lineHeightFactor;
  const lines = wrapText(text.trim(), font, size, width).length;
  // Descent ≈ 0.2·size; keep 0.25·size so hairlines clear glyphs.
  return lines * lineHeight + size * 0.25;
}

/**
 * Draw multi-line text at a fixed font size.
 * `minHeight` applies only when the value is blank (empty-form reservation).
 * When content exists, height follows the measured text. Returns bottom Y.
 */
export function drawTextBlock(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  value: string | undefined,
  box: {
    x: number;
    top: number;
    width: number;
    minHeight?: number;
    size?: number;
    bold?: boolean;
    /** Multiplier on font size for inter-line spacing (default 1.2). */
    lineHeightFactor?: number;
    color?: ReturnType<typeof rgb>;
  },
): number {
  const size = box.size ?? DOC_BODY_TEXT_SIZE;
  const font = box.bold ? bold : regular;
  const lineHeightFactor = box.lineHeightFactor ?? 1.2;
  const lineHeight = size * lineHeightFactor;
  const contentHeight = measureTextHeight(
    value,
    font,
    size,
    box.width,
    lineHeightFactor,
  );
  const height = contentAwareHeight(contentHeight, box.minHeight ?? 0);
  const bottomY = box.top - height;

  if (value?.trim()) {
    const lines = wrapText(value.trim(), font, size, box.width);
    lines.forEach((line, index) => {
      page.drawText(line, {
        x: box.x,
        y: box.top - size - index * lineHeight,
        size,
        font,
        color: box.color ?? BLACK,
      });
    });
  }
  return bottomY;
}

export function drawText(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  value: string | undefined,
  box: TextBox,
): void {
  if (!value?.trim()) return;
  const font = box.bold ? bold : regular;
  const minSize = 4.5;
  let size = box.size ?? 6.8;
  let lineHeight = size * 1.2;
  let lines = wrapText(value.trim(), font, size, box.width);

  // Shrink font until every wrapped line fits the box — never truncate with "...".
  while (size > minSize && lines.length * lineHeight > box.height + 0.01) {
    size = Math.max(minSize, size - 0.35);
    lineHeight = size * 1.2;
    lines = wrapText(value.trim(), font, size, box.width);
  }

  lines.forEach((line, index) => {
    page.drawText(line, {
      x: box.x,
      y: box.y + box.height - size - index * lineHeight,
      size,
      font,
      color: box.color ?? BLACK,
    });
  });
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      const chunks = splitLongWord(word, font, size, width);
      lines.push(...chunks.slice(0, -1));
      line = chunks.at(-1) ?? '';
    }
    if (line) lines.push(line);
  }
  return lines;
}

function splitLongWord(
  word: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const chunks: string[] = [];
  let chunk = '';
  for (const character of Array.from(word)) {
    const candidate = chunk + character;
    if (chunk && font.widthOfTextAtSize(candidate, size) > width) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
