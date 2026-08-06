import { PDFFont, PDFPage, rgb } from 'pdf-lib';
import {
  buildBlCargoPdfRows,
  containerRowHasCargo,
  formatBlGrossWeight,
  formatBlMeasurement,
  normalizeAnContainersPayload,
  resolveBlShippingMark,
  resolveDescriptionOfGoods,
  type BlCargoPdfRow,
} from '../an-container';
import type { BillOfLadingPreviewDto } from '../dto/bill-of-lading-preview.dto';
import type { BookingDocumentRenderContext } from './booking-document-render-context';

/** A4 — matches `FILLED UP_ SUR BL.pdf` page size. */
export const BL_PAGE_WIDTH = 595.28;
export const BL_PAGE_HEIGHT = 841.89;

/**
 * Fit text to BL blank PNG grid (A4). Official sample uses Roboto 8.1
 * on a blank whose horizontals sit ~7.5pt lower; values here are absolute tops
 * on our blank, just below each cell label (not on the bottom rule).
 * Party / route cells add LABEL_TO_VALUE_GAP under the printed label.
 */
const FONT_SIZE = 8.0;
const FONT_SIZE_SMALL = 7.5;
const FONT_SIZE_FBL = 10.5;
const LINE_GAP = 1.15;
/** Cargo body leading (looser than party cells) + pad between logical rows. */
const CARGO_LINE_GAP = 2.3;
/** Small pad between rows inside the FCL block (serviceMode ↔ containers). */
const CARGO_ROW_PAD = 4;
/**
 * Blank rows between cargo blocks: FCL header ↔ Totals (containers + sums)
 * ↔ N/M. Does NOT apply inside the Totals block (container rows → dashes →
 * sum figures stay tight, see CARGO_TO_SUM_GAP_LINES).
 */
const CARGO_BLOCK_GAP_LINES = 1;
/**
 * Blank rows between the last container row and its dashed underline/sum
 * figures, both inside the Totals block. Kept at 0 so containers → dashes →
 * totals sit adjacent, matching the printed BL layout.
 */
const CARGO_TO_SUM_GAP_LINES = 0;
/** Extra pts beyond measured text when drawing cargo total dashes. */
const CARGO_TOTAL_DASH_PAD = 2;
/** Extra top offset so body text clears the blank's cell label (~DOC_LABEL_GAP). */
const LABEL_TO_VALUE_GAP = 3;
const BLACK = rgb(0, 0, 0);
const SURRENDERED_RED = rgb(1, 0, 0);
const SURRENDERED_LABEL = 'SURRENDERED';
const SURRENDERED_FONT_SIZE = 22;
const SURRENDERED_X = 350;
const SURRENDERED_TOP = 270;

type TopLeft = { x: number; top: number; maxWidth: number; maxLines?: number };

/**
 * Absolute A4 coordinates shared by BL blank variants.
 * Transport row rules ≈ 240.25 | 263.25 | 286.75 | 309.0
 * Voyage column ≈ 157; receipt/loading/delivery values ≈ 193.8
 * Cargo columns (blank header starts ≈ 62 | 178.5 | 328.6 | 446.6 | 522.6):
 * marks 62.5 | packages 196→270 (right-align) | desc 318.6 (widened right) | weight 436 | meas 516
 * Packages right edge is ~24.6pt left of description so "20 PALLETS" sits clear
 * of the desc column (desc starts at the blank packages/desc rule ≈ 328,
 * right under the printed header).
 * Marks maxWidth reaches just shy of packages so CONT/SEAL/TYPE fits one line
 * at body FONT_SIZE (clip if still too wide — never shrink size).
 * Desc aligns under printed "Description of goods" header; widened to the
 * right (edge 450.6, was 434.6) with GW nudged the same +16pt (edge 506, was
 * 490) to preserve GW's original clearance. N/M description respects form
 * newlines and wraps within desc width.
 * Footer rules ≈ 701.75 | 725.5 | 750.25; splits ≈ 255 | 379
 */
const BOX = {
  fblNumber: { x: 438.8, top: 36.0, maxWidth: 120, maxLines: 1 },
  consignor: { x: 62.5, top: 42.0 + LABEL_TO_VALUE_GAP, maxWidth: 230, maxLines: 6 },
  consignedToOrderOf: {
    x: 62.5,
    top: 112.0 + LABEL_TO_VALUE_GAP,
    maxWidth: 230,
    maxLines: 5,
  },
  notifyAddress: {
    x: 62.5,
    top: 181.0 + LABEL_TO_VALUE_GAP,
    maxWidth: 230,
    maxLines: 5,
  },
  placeOfReceipt: {
    x: 193.8,
    top: 248.0 + LABEL_TO_VALUE_GAP,
    maxWidth: 160,
    maxLines: 2,
  },
  oceanVessel: {
    x: 62.5,
    top: 271.0 + LABEL_TO_VALUE_GAP,
    maxWidth: 90,
    maxLines: 2,
  },
  voyageNumber: {
    x: 157.0,
    top: 271.0 + LABEL_TO_VALUE_GAP,
    maxWidth: 32,
    maxLines: 1,
  },
  portOfLoading: {
    x: 193.8,
    top: 272.5 + LABEL_TO_VALUE_GAP,
    maxWidth: 160,
    maxLines: 2,
  },
  portOfDischarge: {
    x: 61.0,
    top: 294.5 + LABEL_TO_VALUE_GAP,
    maxWidth: 132,
    maxLines: 2,
  },
  placeOfDelivery: {
    x: 193.8,
    top: 294.5 + LABEL_TO_VALUE_GAP,
    maxWidth: 160,
    maxLines: 2,
  },
  marksAndNumbers: { x: 62.5, top: 323.5, maxWidth: 132, maxLines: 22 },
  /** Right edge 196+74=270 (was 255); right-aligned packages/dash/totals share it. */
  numberAndKindOfPackages: { x: 196.0, top: 323.5, maxWidth: 74, maxLines: 14 },
  /**
   * Left edge restored to original x:318.6 (under the printed "Description of
   * goods" header). Widened to the right instead: was maxWidth:116 → right
   * edge 434.6, now maxWidth:132 → right edge 450.6 (+16pt). GW right-align
   * edge nudged the same +16pt (420→436, edge 490→506) so the clearance
   * between desc's right edge and a typical "25000.000 KGS" value's left ink
   * (~7pt) stays exactly what it was before this widen — still ~10pt clear
   * of the measurement column's left bound (x=516).
   */
  descriptionOfGoods: { x: 318.6, top: 323.5, maxWidth: 132, maxLines: 22 },
  /** GW/meas x nudged left vs blank headers for aesthetics; right-align + dynamic dash. */
  grossWeight: { x: 425.0, top: 323.5, maxWidth: 70, maxLines: 22 },
  measurement: { x: 516.0, top: 323.5, maxWidth: 50, maxLines: 22 },
  /** Cargo body must stop above these two footer lines (kept as-is). */
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
  stamp: { x: 400.0, top: 740.0, maxWidth: 160, maxLines: 1 },
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

/** Leading number from a cargo cell (`21 CRATE(S)`, `21,000`, `7.86`). */
function parseCargoNumber(raw: string): number | null {
  const match = raw
    .replace(/,/g, '')
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function formatCargoTotal(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded);
}

/** Append unit to the right of a cargo number; no-op if already present. */
function appendCargoUnit(raw: string, unit: 'KGS' | 'CBM'): string {
  const t = raw.trim();
  if (!t) return '';
  if (new RegExp(`\\b${unit}\\b`, 'i').test(t)) return t;
  return `${t} ${unit}`;
}

/** Trailing package kind after the leading qty (`21 CRATE(S)` → `CRATE(S)`). */
function packageTypeSuffix(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  const match = t.replace(/,/g, '').match(/^-?\d+(?:\.\d+)?\s*(.*)$/);
  return (match?.[1] ?? '').trim();
}

/**
 * Whether `CARGO_BLOCK_GAP_LINES` blank rows belong between `current` and
 * `next` (vs. the tight `CARGO_ROW_PAD` used between rows in the same
 * block). Decided purely from each row's structural `kind` — see the
 * `drawAlignedBlCargoRows` doc comment for why a text-content heuristic
 * (e.g. "next row's marks === 'N/M'") previously missed the FCL header →
 * first container transition.
 */
export function isBlCargoBlockBoundary(
  current: BlCargoPdfRow,
  next: BlCargoPdfRow | undefined,
): boolean {
  return Boolean(next && next.kind !== current.kind);
}

function isBlNumericCargoRow(row: BlCargoPdfRow): boolean {
  return Boolean(
    row.packages.trim() ||
      row.grossWeight.trim() ||
      row.measurement.trim(),
  );
}

/**
 * Sum packages / GW / measurement across per-container cargo rows.
 * Packages uses the leading number only (`21` from `21 CRATE(S)`).
 * Totals keep units/labels: `42 CRATE(S)`, `39000 KGS`, `62.86 CBM` — same
 * "qty + unit" shape as each per-container row, never bare numbers.
 */
export function sumBlNumericCargoTotals(rows: BlCargoPdfRow[]): {
  packages: string;
  grossWeight: string;
  measurement: string;
} | null {
  let pkgSum = 0;
  let gwSum = 0;
  let measSum = 0;
  let hasPkg = false;
  let hasGw = false;
  let hasMeas = false;
  let pkgType: string | undefined;
  let pkgTypeConflict = false;

  for (const row of rows) {
    if (!isBlNumericCargoRow(row)) continue;
    const pkg = parseCargoNumber(row.packages);
    if (pkg !== null) {
      pkgSum += pkg;
      hasPkg = true;
      const suffix = packageTypeSuffix(row.packages);
      if (suffix) {
        if (pkgType === undefined) pkgType = suffix;
        else if (suffix !== pkgType) pkgTypeConflict = true;
      }
    }
    const gw = parseCargoNumber(row.grossWeight);
    if (gw !== null) {
      gwSum += gw;
      hasGw = true;
    }
    const meas = parseCargoNumber(row.measurement);
    if (meas !== null) {
      measSum += meas;
      hasMeas = true;
    }
  }

  if (!hasPkg && !hasGw && !hasMeas) return null;
  const pkgTotal = hasPkg ? formatCargoTotal(pkgSum) : '';
  return {
    packages:
      pkgTotal && !pkgTypeConflict && pkgType
        ? `${pkgTotal} ${pkgType}`
        : pkgTotal,
    grossWeight: hasGw ? appendCargoUnit(formatCargoTotal(gwSum), 'KGS') : '',
    measurement: hasMeas
      ? appendCargoUnit(formatCargoTotal(measSum), 'CBM')
      : '',
  };
}

/** Widest drawn string width (font metrics) among cargo column texts. */
function maxCargoColumnTextWidth(
  texts: Iterable<string>,
  font: PDFFont,
  fontSize: number,
): number {
  let max = 0;
  for (const raw of texts) {
    const text = raw.trim();
    if (!text) continue;
    max = Math.max(max, font.widthOfTextAtSize(text, fontSize));
  }
  return max;
}

/** Right edge of a cargo column box. */
function cargoColumnRightEdge(field: TopLeft): number {
  return field.x + field.maxWidth;
}

/** Short accounting underline under a numeric cargo column (not full cell width). */
function drawCargoTotalUnderline(
  page: PDFPage,
  field: TopLeft,
  top: number,
  width: number,
) {
  const y = BL_PAGE_HEIGHT - top;
  const w = Math.min(Math.max(width, 0), field.maxWidth);
  if (w <= 0) return;
  // Right-aligned: same right edge as value/total text; width is measured text + pad.
  const right = cargoColumnRightEdge(field);
  page.drawLine({
    start: { x: right - w, y },
    end: { x: right, y },
    thickness: 0.65,
    color: BLACK,
    dashArray: [2.2, 1.4],
  });
}

/**
 * Keep text on one horizontal line at the given font size (no size shrink).
 * Collapse whitespace; clip characters only if still wider than maxWidth.
 */
function clipToSingleLine(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  if (font.widthOfTextAtSize(normalized, fontSize) <= maxWidth) {
    return normalized;
  }

  let lo = 1;
  let hi = normalized.length;
  let fit = 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = normalized.slice(0, mid);
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      fit = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return normalized.slice(0, fit);
}

/**
 * Draw BL cargo as aligned multi-line columns (same line index = same Y).
 * Three logical blocks, separated by CARGO_BLOCK_GAP_LINES blank rows each
 * (lineStep * CARGO_BLOCK_GAP_LINES): FCL header (serviceMode + volume STC)
 * ↔ Totals (container rows + dashed underlines + sum figures) ↔ N/M. Block
 * boundaries are detected structurally from each row's `kind` (set by
 * `buildBlCargoPdfRows`), not by sniffing text content — a prior version
 * only special-cased "next row's marks === 'N/M'", which never matched the
 * FCL header → first container transition, so that gap silently collapsed
 * to the tiny CARGO_ROW_PAD. Inside the Totals block the container rows,
 * dashes, and sum figures stay tight (CARGO_TO_SUM_GAP_LINES) so they read
 * as one grouped total, matching the printed BL layout.
 * Stops before freightTerms so the two cargo-footer lines stay clear.
 */
function drawAlignedBlCargoRows(
  page: PDFPage,
  font: PDFFont,
  rows: BlCargoPdfRow[],
) {
  const fontSize = FONT_SIZE;
  const lineStep = fontSize + CARGO_LINE_GAP;
  const cargoTop = BOX.marksAndNumbers.top;
  // Leave a small gap above freightTerms / cleanOnBoard.
  const cargoBottom = BOX.freightTerms.top - 4;
  const maxLines = Math.min(
    BOX.marksAndNumbers.maxLines ?? 22,
    Math.max(1, Math.floor((cargoBottom - cargoTop) / lineStep)),
  );
  // Structural (not text-content) index of the last container row — the
  // Totals block ends here, so the sum figures + block gap before N/M are
  // anchored to it regardless of whether that specific row has numeric data.
  const lastContainerIdx = rows.reduce(
    (acc, row, i) => (row.kind === 'container' ? i : acc),
    -1,
  );
  const totals = sumBlNumericCargoTotals(rows);

  let lineOffset = 0;
  let topCursor = cargoTop;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (lineOffset >= maxLines || topCursor >= cargoBottom) break;

    const remainingByLines = maxLines - lineOffset;
    const remainingByHeight = Math.max(
      1,
      Math.floor((cargoBottom - topCursor) / lineStep) + 1,
    );
    const remaining = Math.min(remainingByLines, remainingByHeight);
    const isContainerRow = row.kind === 'container';
    let marksLines: string[];
    if (isContainerRow && row.marks.trim()) {
      const line = clipToSingleLine(
        row.marks,
        font,
        fontSize,
        BOX.marksAndNumbers.maxWidth,
      );
      marksLines = line ? [line] : [];
    } else {
      marksLines = wrapLines(
        row.marks,
        font,
        fontSize,
        BOX.marksAndNumbers.maxWidth,
        remaining,
      );
    }
    const packagesLines = wrapLines(
      row.packages,
      font,
      fontSize,
      BOX.numberAndKindOfPackages.maxWidth,
      remaining,
    );
    // Respect intentional newlines in descriptionOfGoods; wrap long lines.
    const descLines = wrapLines(
      row.description,
      font,
      fontSize,
      BOX.descriptionOfGoods.maxWidth,
      remaining,
    );
    const gwLines = wrapLines(
      appendCargoUnit(row.grossWeight, 'KGS'),
      font,
      fontSize,
      BOX.grossWeight.maxWidth,
      remaining,
    );
    const measLines = wrapLines(
      appendCargoUnit(row.measurement, 'CBM'),
      font,
      fontSize,
      BOX.measurement.maxWidth,
      remaining,
    );

    const rowHeight = Math.max(
      marksLines.length,
      packagesLines.length,
      descLines.length,
      gwLines.length,
      measLines.length,
      row.marks ||
        row.packages ||
        row.description ||
        row.grossWeight ||
        row.measurement
        ? 1
        : 0,
    );
    if (rowHeight === 0) continue;

    for (let i = 0; i < rowHeight; i += 1) {
      const top = topCursor + i * lineStep;
      if (top >= cargoBottom) break;
      const draw = (
        text: string | undefined,
        field: TopLeft,
        opts?: { align?: 'left' | 'right' },
      ) => {
        const line = (text ?? '').trimEnd();
        if (!line) return;
        const align = opts?.align ?? 'left';
        const textWidth = font.widthOfTextAtSize(line, fontSize);
        const x =
          align === 'right'
            ? cargoColumnRightEdge(field) - textWidth
            : field.x;
        page.drawText(line, {
          x,
          y: pdfYFromTop(top, fontSize, font),
          size: fontSize,
          font,
          color: BLACK,
        });
      };
      draw(marksLines[i], BOX.marksAndNumbers);
      draw(packagesLines[i], BOX.numberAndKindOfPackages, { align: 'right' });
      draw(descLines[i], BOX.descriptionOfGoods);
      draw(gwLines[i], BOX.grossWeight, { align: 'right' });
      draw(measLines[i], BOX.measurement, { align: 'right' });
    }
    lineOffset += rowHeight;
    // Just below the last ink line of this logical row.
    topCursor += rowHeight * lineStep;

    // Accounting underlines + totals under the 3 numeric columns, after the
    // last container value row and before N/M / description. Both the
    // container rows and this sum stay inside the Totals block, so the gap
    // here is tight (not the inter-block CARGO_BLOCK_GAP_LINES).
    if (rowIndex === lastContainerIdx && totals) {
      topCursor += lineStep * CARGO_TO_SUM_GAP_LINES;
      lineOffset += CARGO_TO_SUM_GAP_LINES;

      const underlineTop = topCursor + 1.5;
      if (underlineTop < cargoBottom) {
        if (totals.packages) {
          const packagesDashWidth =
            maxCargoColumnTextWidth(
              [
                ...rows
                  .filter(isBlNumericCargoRow)
                  .map((r) => r.packages),
                totals.packages,
              ],
              font,
              fontSize,
            ) + CARGO_TOTAL_DASH_PAD;
          drawCargoTotalUnderline(
            page,
            BOX.numberAndKindOfPackages,
            underlineTop,
            packagesDashWidth,
          );
        }
        if (totals.grossWeight) {
          const gwDashWidth =
            maxCargoColumnTextWidth(
              [
                ...rows
                  .filter(isBlNumericCargoRow)
                  .map((r) => appendCargoUnit(r.grossWeight, 'KGS')),
                totals.grossWeight,
              ],
              font,
              fontSize,
            ) + CARGO_TOTAL_DASH_PAD;
          drawCargoTotalUnderline(
            page,
            BOX.grossWeight,
            underlineTop,
            gwDashWidth,
          );
        }
        if (totals.measurement) {
          const measDashWidth =
            maxCargoColumnTextWidth(
              [
                ...rows
                  .filter(isBlNumericCargoRow)
                  .map((r) => appendCargoUnit(r.measurement, 'CBM')),
                totals.measurement,
              ],
              font,
              fontSize,
            ) + CARGO_TOTAL_DASH_PAD;
          drawCargoTotalUnderline(
            page,
            BOX.measurement,
            underlineTop,
            measDashWidth,
          );
        }
      }

      const totalTextTop = underlineTop + 3.5;
      if (totalTextTop < cargoBottom && lineOffset < maxLines) {
        const drawTotal = (text: string, field: TopLeft) => {
          if (!text) return;
          const textWidth = font.widthOfTextAtSize(text, fontSize);
          page.drawText(text, {
            x: cargoColumnRightEdge(field) - textWidth,
            y: pdfYFromTop(totalTextTop, fontSize, font),
            size: fontSize,
            font,
            color: BLACK,
          });
        };
        drawTotal(totals.packages, BOX.numberAndKindOfPackages);
        drawTotal(totals.grossWeight, BOX.grossWeight);
        drawTotal(totals.measurement, BOX.measurement);
        lineOffset += 1;
        topCursor = totalTextTop + lineStep;
      } else {
        topCursor = underlineTop + 2;
      }

      // CARGO_BLOCK_GAP_LINES blank rows: totals → N/M.
      topCursor += lineStep * CARGO_BLOCK_GAP_LINES;
      lineOffset += CARGO_BLOCK_GAP_LINES;
      continue;
    }

    // See `isBlCargoBlockBoundary` — block boundary is determined
    // structurally by `row.kind`, not by sniffing text content (e.g. "next
    // row's marks === 'N/M'"). That old heuristic never matched the FCL
    // header → first container transition (marks there is a container no.
    // like "SITU2608023 / ... / 20'DC", not "N/M"), so the header always
    // fell through to the tiny CARGO_ROW_PAD — the FCL→Totals gap was never
    // actually drawn.
    const nextRow = rows[rowIndex + 1];
    if (isBlCargoBlockBoundary(row, nextRow)) {
      topCursor += lineStep * CARGO_BLOCK_GAP_LINES;
      lineOffset += CARGO_BLOCK_GAP_LINES;
    } else {
      topCursor += CARGO_ROW_PAD;
    }
  }
}

function drawCheckMark(page: PDFPage, font: PDFFont, x: number, top: number) {
  page.drawText('X', {
    x,
    y: pdfYFromTop(top, FONT_SIZE, font),
    size: FONT_SIZE,
    font,
    color: BLACK,
  });
}

export function drawBillOfLadingSurrenderedMark(
  page: PDFPage,
  font: PDFFont,
): void {
  page.drawText(SURRENDERED_LABEL, {
    x: SURRENDERED_X,
    y: pdfYFromTop(SURRENDERED_TOP, SURRENDERED_FONT_SIZE, font),
    size: SURRENDERED_FONT_SIZE,
    font,
    color: SURRENDERED_RED,
  });
}

/**
 * Overlay typed FBL fields onto the embedded blank page.
 * Caller must already draw the selected template image full-bleed on page 0.
 * Author signature is always drawn when available in the render context.
 *
 * Layout constraint: coordinates in `BOX` are calibrated to the blank PNG grid.
 * Party / cargo fields wrap and clip inside each fixed cell (`maxLines`) — they
 * must not push neighboring boxes (doing so would misalign the printed form).
 * Unlike AN / DO / Booking Confirmation, this overlay is not vertically flexible.
 */
export function renderBillOfLading(
  context: BookingDocumentRenderContext,
  payload: BillOfLadingPreviewDto,
): void {
  const page = context.pdf.getPage(0);
  const font = context.regular;
  const bold = context.bold;

  const containers = normalizeAnContainersPayload({
    containers: payload.containers,
  });
  const descriptionOfGoods = resolveDescriptionOfGoods({
    descriptionOfGoods: payload.descriptionOfGoods,
    containers,
  });
  const serviceMode = (payload.serviceMode ?? '').trim();
  const hasStructuredCargo =
    containers.some(containerRowHasCargo) || Boolean(serviceMode);

  if (payload.blFormVariant === 'surrendered') {
    drawBillOfLadingSurrenderedMark(page, bold);
  }

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

  /*
   * Cargo body (marks | packages | description | GW | measurement):
   *   Block 1 FCL header: serviceMode | — | volume STC
   *   — CARGO_BLOCK_GAP_LINES blank rows —
   *   Block 2 Totals: CONT / SEAL / TYPE rows, then dashed underlines +
   *     sum packages / GW / meas (tight, see CARGO_TO_SUM_GAP_LINES)
   *   — CARGO_BLOCK_GAP_LINES blank rows —
   *   Block 3 shipping mark: shippingMark | — | descriptionOfGoods
   * Per-container packages / GW / measurement; totals only on the 3 numeric cols.
   * freightTerms + cleanOnBoard below stay unchanged.
   */
  if (hasStructuredCargo) {
    drawAlignedBlCargoRows(
      page,
      font,
      buildBlCargoPdfRows({
        serviceMode,
        containers,
        descriptionOfGoods,
        shippingMark: resolveBlShippingMark(payload),
      }),
    );
  } else {
    drawBoxText(
      page,
      font,
      resolveBlShippingMark(payload),
      BOX.marksAndNumbers,
    );
    drawBoxText(
      page,
      font,
      payload.numberAndKindOfPackages,
      BOX.numberAndKindOfPackages,
    );
    drawBoxText(
      page,
      font,
      payload.descriptionOfGoods,
      BOX.descriptionOfGoods,
    );
    drawBoxText(page, font, payload.grossWeight, BOX.grossWeight);
    drawBoxText(page, font, payload.measurement, BOX.measurement);
  }

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
    drawCheckMark(page, bold, BOX.insuranceCovered.x, BOX.insuranceCovered.top);
  }

  if (context.managerStamp) {
    const stampW = 224;
    const stampH =
      (context.managerStamp.height / context.managerStamp.width) * stampW;
    let stampX = BOX.stamp.x + 20;
    let stampY = BL_PAGE_HEIGHT - BOX.stamp.top - stampH;
    if (stampX + stampW > BL_PAGE_WIDTH) {
      stampX = BL_PAGE_WIDTH - stampW;
    }
    if (stampY < 0) {
      stampY = 0;
    }
    page.drawImage(context.managerStamp, {
      x: stampX,
      y: stampY,
      width: stampW,
      height: stampH,
      opacity: 0.92,
    });
  }
}
