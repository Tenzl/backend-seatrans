import { rgb } from 'pdf-lib';
import {
  anContainersToCargoRows,
  normalizeAnContainersPayload,
} from '../an-container';
import { DeliveryOrderPreviewDto } from '../dto/delivery-order-preview.dto';
import { BookingDocumentRenderContext } from './booking-document-render-context';
import {
  BELOW_RULE_BASELINE,
  BLACK,
  columnValueLayout,
  contentAwareHeight,
  DETAIL_LABEL_SIZE,
  DOC_BODY_TEXT_SIZE,
  DOC_CELL_PAD,
  DOC_FRAME_LEFT,
  DOC_FRAME_MID,
  DOC_FRAME_RIGHT,
  DOC_HEADER_TOP,
  DOC_LABEL_GAP,
  DOC_LEFT_W,
  DOC_LEFT_X,
  DOC_RIGHT_W,
  DOC_RIGHT_X,
  DOC_SECTION_GAP,
  DOC_SECTION_LABEL_SIZE,
  drawLabelValueRows,
  drawLetterhead,
  drawMetaHeaderRow,
  drawPairedLabeledBlocks,
  drawRule,
  drawText,
  drawTextBlock,
  finishCargoAndAttentionPage,
  FRAME_TEXT_INSET,
  measureTextHeight,
} from './pdf-layout';

const TEXT_SIZE = DOC_BODY_TEXT_SIZE;
const LABEL_SIZE = DOC_SECTION_LABEL_SIZE;
const FRAME_LEFT = DOC_FRAME_LEFT;
const FRAME_MID = DOC_FRAME_MID;
const FRAME_RIGHT = DOC_FRAME_RIGHT;
const LEFT_X = DOC_LEFT_X;
const RIGHT_X = DOC_RIGHT_X;
const LEFT_W = DOC_LEFT_W;
const RIGHT_W = DOC_RIGHT_W;
const LABEL_GAP = DOC_LABEL_GAP;
/** Absolute wipe / frame floor — clears template chrome under long Marks. */
const PAGE_FLOOR = 48;
const CARGO_HEADER_HEIGHT = 22;
const CARGO_MIN_ROW = (422 - 316 - CARGO_HEADER_HEIGHT) / 4;
const EMPTY_DELIVER_MIN = 53;
const EMPTY_NOTIFY_MIN = 36;
const EMPTY_NOTE_MIN = 36;
const EMPTY_MARKS_MIN = 22;
const EMPTY_ATTENTION_MIN = 24;
/** Gap between deliver block and Notify party inside the combined left cell. */
const DELIVER_NOTIFY_GAP = DOC_SECTION_GAP * 2;

const RIGHT_LABELS = [
  'MBL No.:',
  'HBL No.:',
  'ETD:',
  'ETA:',
  'Shipment No.:',
  'Vessel/Voyage No.:',
  'Place of Receipt:',
  'Port of Loading:',
  'Port of Discharge:',
  'Place of Delivery:',
  'Final Destination:',
  'Service Mode:',
  'CFS Terminal:',
];

export function renderDeliveryOrder(
  { pdf, regular, bold, header, managerStamp }: BookingDocumentRenderContext,
  dto: DeliveryOrderPreviewDto,
): void {
  const page = pdf.getPage(0);
  drawLetterhead(page, header, bold, 'DELIVERY ORDER', {
    clearBottom: DOC_HEADER_TOP,
    titleY: 708,
  });

  page.drawRectangle({
    x: FRAME_LEFT - 0.5,
    y: PAGE_FLOOR - 1,
    width: FRAME_RIGHT - FRAME_LEFT + 1,
    height: DOC_HEADER_TOP - PAGE_FLOOR + 2,
    color: rgb(1, 1, 1),
  });

  const headerBottom = drawMetaHeaderRow(page, regular, bold, {
    left: { label: 'To:', value: dto.to },
    mid: { label: 'Date:', value: dto.date },
    right: { label: 'DO No.:', value: dto.doNumber },
  });

  const { valueX, valueWidth } = columnValueLayout(
    RIGHT_X,
    FRAME_RIGHT - FRAME_TEXT_INSET,
    RIGHT_LABELS,
    bold,
  );

  const sectionTop = headerBottom;

  // Right: 4 stacked frames — MBL/HBL | ETD/ETA/Shipment | Vessel…CFS | Note
  const { dividers, bottom: rightBandBottom } = drawRightFourFrames(
    page,
    regular,
    bold,
    dto,
    sectionTop,
    valueX,
    valueWidth,
  );

  // Left: one cell spanning those 4 frames — deliver + gap + Notify party
  const leftBandBottom = drawDeliverAndNotifyColumn(
    page,
    regular,
    bold,
    dto,
    sectionTop,
  );

  // Combined band is as tall as the taller side (left wraps the 4 right frames).
  const bandBottom = Math.min(leftBandBottom, rightBandBottom);

  // Marks | Volume below the combined band
  const marksBottom = drawPairedLabeledBlocks(
    page,
    regular,
    bold,
    { label: 'Marks', value: dto.marks, x: LEFT_X, width: LEFT_W },
    { label: 'Volume', value: dto.volume, x: RIGHT_X, width: RIGHT_W },
    { sectionTop: bandBottom, emptyMinHeight: EMPTY_MARKS_MIN },
  );

  const frameBottom = Math.max(marksBottom, PAGE_FLOOR);
  drawRule(page, FRAME_LEFT, marksBottom, FRAME_RIGHT, marksBottom);
  drawRule(page, FRAME_LEFT, headerBottom, FRAME_LEFT, frameBottom);
  drawRule(page, FRAME_MID, headerBottom, FRAME_MID, frameBottom);
  drawRule(page, FRAME_RIGHT, headerBottom, FRAME_RIGHT, frameBottom);
  // Bottom of the combined deliver/notify | 4-frame band
  drawRule(page, FRAME_LEFT, bandBottom, FRAME_RIGHT, bandBottom);
  // Internal horizontals only on the right (4 frames), not across the left cell
  for (const y of dividers) {
    if (y < sectionTop - 1 && y > bandBottom + 1) {
      drawRule(page, FRAME_MID, y, FRAME_RIGHT, y);
    }
  }

  // Cargo / container rows mirror BL: same container model (up to 20 rows),
  // one PDF line per container — see `an-container.ts` shared helpers.
  const containers = normalizeAnContainersPayload({
    containers: dto.containers,
    cargoRows: dto.cargoRows,
  });
  const cargoRows =
    containers.length > 0 ? anContainersToCargoRows(containers) : (dto.cargoRows ?? []);

  finishCargoAndAttentionPage(pdf, page, regular, bold, {
    marksBottom,
    cargoRows,
    title: 'DELIVERY ORDER',
    attentionText: dto.customerAttention,
    includeForSeatrans: true,
    managerStamp,
    pageFloor: PAGE_FLOOR,
    cargoHeaderHeight: CARGO_HEADER_HEIGHT,
    cargoMinRowHeight: CARGO_MIN_ROW,
    emptyAttentionMin: EMPTY_ATTENTION_MIN,
  });
}

/**
 * Left cell: "Please kindly deliver…" + body, gap, then "Notify party:" + body.
 * Returns content bottom Y (including bottom pad).
 */
function drawDeliverAndNotifyColumn(
  page: Parameters<typeof drawText>[0],
  regular: Parameters<typeof drawText>[1],
  bold: Parameters<typeof drawText>[2],
  dto: DeliveryOrderPreviewDto,
  sectionTop: number,
): number {
  const pad = DOC_CELL_PAD;
  const prompt = 'Please kindly deliver the following shipment to:';
  const promptTop = sectionTop - pad;
  page.drawText(prompt, {
    x: LEFT_X,
    y: promptTop - LABEL_SIZE,
    size: LABEL_SIZE,
    font: bold,
    color: BLACK,
  });
  const deliverBottom = drawTextBlock(page, regular, bold, dto.deliverTo, {
    x: LEFT_X,
    top: promptTop - LABEL_SIZE - LABEL_GAP,
    width: LEFT_W,
    minHeight: contentAwareHeight(
      measureTextHeight(dto.deliverTo, regular, TEXT_SIZE, LEFT_W),
      EMPTY_DELIVER_MIN,
    ),
    size: TEXT_SIZE,
  });

  const notifyLabelTop = deliverBottom - DELIVER_NOTIFY_GAP;
  page.drawText('Notify party:', {
    x: LEFT_X,
    y: notifyLabelTop - LABEL_SIZE,
    size: LABEL_SIZE,
    font: bold,
    color: BLACK,
  });
  const notifyBottom = drawTextBlock(page, regular, bold, dto.notifyParty, {
    x: LEFT_X,
    top: notifyLabelTop - LABEL_SIZE - LABEL_GAP,
    width: LEFT_W,
    minHeight: contentAwareHeight(
      measureTextHeight(dto.notifyParty, regular, TEXT_SIZE, LEFT_W),
      EMPTY_NOTIFY_MIN,
    ),
    size: TEXT_SIZE,
  });
  return notifyBottom - pad;
}

/**
 * Four right-column frames from sectionTop downward.
 * Returns divider Ys (between frames) and the Note frame bottom.
 */
function drawRightFourFrames(
  page: Parameters<typeof drawText>[0],
  regular: Parameters<typeof drawText>[1],
  bold: Parameters<typeof drawText>[2],
  dto: DeliveryOrderPreviewDto,
  sectionTop: number,
  valueX: number,
  valueWidth: number,
): { dividers: number[]; bottom: number } {
  const dividers: number[] = [];
  let y = sectionTop - BELOW_RULE_BASELINE;

  y = drawLabelValueRows(
    page,
    regular,
    bold,
    [
      ['MBL No.:', dto.mblNumber],
      ['HBL No.:', dto.hblNumber],
    ],
    {
      labelX: RIGHT_X,
      valueX,
      valueWidth,
      y,
      labelSize: DETAIL_LABEL_SIZE,
      valueSize: DOC_BODY_TEXT_SIZE,
    },
  );
  dividers.push(y + 4);
  y -= 6;

  y = drawLabelValueRows(
    page,
    regular,
    bold,
    [
      ['ETD:', dto.etd],
      ['ETA:', dto.eta],
      ['Shipment No.:', dto.shipmentNumber],
    ],
    {
      labelX: RIGHT_X,
      valueX,
      valueWidth,
      y,
      labelSize: DETAIL_LABEL_SIZE,
      valueSize: DOC_BODY_TEXT_SIZE,
    },
  );
  dividers.push(y + 4);
  y -= 6;

  y = drawLabelValueRows(
    page,
    regular,
    bold,
    [
      ['Vessel/Voyage No.:', dto.vesselVoyage],
      ['Place of Receipt:', dto.placeOfReceipt],
      ['Port of Loading:', dto.portOfLoading],
      ['Port of Discharge:', dto.portOfDischarge],
      ['Place of Delivery:', dto.placeOfDelivery],
      ['Final Destination:', dto.finalDestination],
      ['Service Mode:', dto.serviceMode],
      ['CFS Terminal:', dto.cfsTerminal],
    ],
    {
      labelX: RIGHT_X,
      valueX,
      valueWidth,
      y,
      labelSize: DETAIL_LABEL_SIZE,
      valueSize: DOC_BODY_TEXT_SIZE,
    },
  );
  dividers.push(y + 4);

  // Frame 4: Note
  const noteTop = y + 4;
  const pad = DOC_CELL_PAD;
  page.drawText('Note:', {
    x: RIGHT_X,
    y: noteTop - pad - LABEL_SIZE,
    size: LABEL_SIZE,
    font: bold,
    color: BLACK,
  });
  const noteBottom = drawTextBlock(page, regular, bold, dto.note, {
    x: RIGHT_X,
    top: noteTop - pad - LABEL_SIZE - LABEL_GAP,
    width: RIGHT_W,
    minHeight: contentAwareHeight(
      measureTextHeight(dto.note, regular, TEXT_SIZE, RIGHT_W),
      EMPTY_NOTE_MIN,
    ),
    size: TEXT_SIZE,
  });

  return { dividers, bottom: noteBottom - pad };
}
