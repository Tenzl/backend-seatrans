import { rgb } from 'pdf-lib';
import {
  anContainersToCargoRows,
  anContainersToVolumeText,
  normalizeAnContainersPayload,
  resolveDescriptionOfGoods,
} from '../an-container';
import { ArrivalNoticePreviewDto } from '../dto/arrival-notice-preview.dto';
import { BookingDocumentRenderContext } from './booking-document-render-context';
import {
  BELOW_RULE_BASELINE,
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
  drawLabeledBlock,
  drawLabelValueRows,
  drawLetterhead,
  drawMetaHeaderRow,
  drawPairedLabeledBlocks,
  drawRule,
  drawTextBlock,
  finishCargoAndAttentionPage,
  FRAME_TEXT_INSET,
  LABEL_VALUE_GAP,
  LabelValuePair,
  maxLabelWidth,
  partyDisplayName,
  REFERENCE_LABEL_SIZE,
  syncDividerY,
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
const PAGE_MIN_BOTTOM = 48;
const CARGO_HEADER_HEIGHT = 18;
const CARGO_MIN_ROW = (329 - 220 - CARGO_HEADER_HEIGHT) / 4;
const EMPTY_SHIPPER_MIN = 94;
const EMPTY_CONSIGNEE_MIN = 91;
const EMPTY_NOTIFY_MIN = 36;
const EMPTY_MARKS_MIN = 22;

const RIGHT_LABELS = [
  'MBL No.:',
  'HBL No.:',
  'Vessel/Voyage No.:',
  'ETD:',
  'ETA:',
  'CFS Terminal:',
  'Shipment No.:',
  'Ref. No.:',
  'Type of B/L:',
  'Place of Receipt:',
  'Port of Loading:',
  'Port of Discharge:',
  'Place of Delivery:',
  'Final Destination:',
  'Service Mode:',
];

/** Ref. No. stays visually stronger than sibling meta labels (bold + size). */
const EMPHASIZED_RIGHT_LABELS = new Set(['Ref. No.:']);

/** PDF value only — strip a leading ETD/ETA label from one date string. */
export function formatScheduleDateForPdf(value?: string): string {
  if (!value?.trim()) return value ?? '';
  return value.replace(/^\s*(ETD|ETA)\b[:\s-]*/i, '').trim();
}

/** PDF value only — strip leading ETD/ETA from each side of "a / b". */
export function formatEtdEtaForPdf(value?: string): string {
  if (!value?.trim()) return value ?? '';
  return value
    .split('/')
    .map((part) => formatScheduleDateForPdf(part))
    .filter(Boolean)
    .join(' / ');
}

/** Prefer split etd/eta; fall back to legacy combined etdEta. */
export function resolveArrivalNoticeSchedule(dto: {
  etd?: string;
  eta?: string;
  etdEta?: string;
}): { etd: string; eta: string } {
  const etd = formatScheduleDateForPdf(dto.etd);
  const eta = formatScheduleDateForPdf(dto.eta);
  if (etd || eta) return { etd, eta };
  const combined = formatEtdEtaForPdf(dto.etdEta);
  if (!combined) return { etd: '', eta: '' };
  const parts = combined
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    etd: parts[0] ?? '',
    eta: parts.slice(1).join(' / '),
  };
}

export function renderArrivalNotice(
  { pdf, regular, bold, header }: BookingDocumentRenderContext,
  dto: ArrivalNoticePreviewDto,
): void {
  const page = pdf.getPage(0);
  drawLetterhead(page, header, bold, 'ARRIVAL NOTICE', {
    clearBottom: DOC_HEADER_TOP,
    titleY: 708,
  });

  // Wipe all template body chrome (double hairlines) below the letterhead rule.
  page.drawRectangle({
    x: FRAME_LEFT - 0.5,
    y: PAGE_MIN_BOTTOM - 1,
    width: FRAME_RIGHT - FRAME_LEFT + 1,
    height: DOC_HEADER_TOP - (PAGE_MIN_BOTTOM - 1),
    color: rgb(1, 1, 1),
  });

  // Meta header grows with wrapped Agent (and Date / AN No.); body starts below it.
  // Agent: name only (mirror Booking Confirmation To) — never address / TEL / FAX.
  const headerBottom = drawMetaHeaderRow(page, regular, bold, {
    left: { label: 'Agent:', value: partyDisplayName(dto.agent) },
    mid: { label: 'Date:', value: dto.date },
    right: { label: 'AN No.:', value: dto.anNumber },
  });

  // Align values after the widest label, accounting for Ref. No. at larger size.
  const valueRight = FRAME_RIGHT - FRAME_TEXT_INSET;
  const valueX =
    RIGHT_X +
    Math.max(
      maxLabelWidth(
        RIGHT_LABELS.filter((label) => !EMPHASIZED_RIGHT_LABELS.has(label)),
        bold,
        DETAIL_LABEL_SIZE,
      ),
      maxLabelWidth(
        [...EMPHASIZED_RIGHT_LABELS],
        bold,
        REFERENCE_LABEL_SIZE,
      ),
    ) +
    LABEL_VALUE_GAP;
  const valueWidth = Math.max(40, valueRight - valueX);

  const bodyTop = headerBottom;
  const shipperLabelTop = bodyTop - DOC_CELL_PAD;

  const introBottom = drawTextBlock(
    page,
    regular,
    bold,
    'We are pleased to inform that you have an incoming shipment with details as follows:',
    {
      x: RIGHT_X,
      top: shipperLabelTop,
      width: FRAME_RIGHT - FRAME_TEXT_INSET - RIGHT_X,
      size: TEXT_SIZE,
    },
  );

  // Right groups beside Shipper (MBL…Type of B/L), then sync divider with Shipper bottom.
  let rightY = introBottom - DOC_SECTION_GAP * 2;
  const schedule = resolveArrivalNoticeSchedule(dto);
  const shipperSideGroups: LabelValuePair[][] = [
    [
      ['MBL No.:', dto.mblNumber],
      ['HBL No.:', dto.hblNumber],
    ],
    [
      ['Vessel/Voyage No.:', dto.vesselVoyage],
      ['ETD:', schedule.etd],
      ['ETA:', schedule.eta],
      ['CFS Terminal:', dto.cfsTerminal],
      ['Shipment No.:', dto.shipmentNumber],
      ['Ref. No.:', dto.referenceNumber],
      ['Type of B/L:', dto.billOfLadingType],
    ],
  ];
  shipperSideGroups.forEach((group, groupIndex) => {
    if (groupIndex > 0) {
      drawRule(page, FRAME_MID, rightY + 4, FRAME_RIGHT, rightY + 4);
      rightY -= 6;
    }
    rightY = drawLabelValueRows(page, regular, bold, group, {
      labelX: RIGHT_X,
      valueX,
      valueWidth,
      y: rightY,
      labelSize: DETAIL_LABEL_SIZE,
      emphasizedLabels: EMPHASIZED_RIGHT_LABELS,
      valueSize: DOC_BODY_TEXT_SIZE,
    });
  });
  const rightShipperDividerY = rightY + 4;

  // Shipper flows under Agent — same rhythm as Consignee under Shipper.
  const shipperBottom = drawLabeledBlock(page, regular, bold, {
    label: 'Shipper:',
    labelY: shipperLabelTop - LABEL_SIZE,
    value: dto.shipper,
    x: LEFT_X,
    top: shipperLabelTop - LABEL_SIZE - LABEL_GAP,
    width: LEFT_W,
    minHeight: EMPTY_SHIPPER_MIN,
  });

  // Continuous row boundary: Shipper bottom = start of Place-of-Receipt block.
  const shipperDividerY = syncDividerY(shipperBottom, rightShipperDividerY);

  const routingGroup: LabelValuePair[] = [
    ['Place of Receipt:', dto.placeOfReceipt],
    ['Port of Loading:', dto.portOfLoading],
    ['Port of Discharge:', dto.portOfDischarge],
    ['Place of Delivery:', dto.placeOfDelivery],
    ['Final Destination:', dto.finalDestination],
    ['Service Mode:', dto.serviceMode],
  ];
  const rightBottom =
    drawLabelValueRows(page, regular, bold, routingGroup, {
      labelX: RIGHT_X,
      valueX,
      valueWidth,
      y: shipperDividerY - BELOW_RULE_BASELINE,
      labelSize: DETAIL_LABEL_SIZE,
      valueSize: DOC_BODY_TEXT_SIZE,
    }) - 8;

  const consigneeLabelY = shipperDividerY - DOC_CELL_PAD;
  const consigneeTop = consigneeLabelY - LABEL_SIZE - LABEL_GAP;
  const consigneeBottom = drawLabeledBlock(page, regular, bold, {
    label: 'Consignee:',
    labelY: consigneeLabelY - LABEL_SIZE,
    value: dto.consignee,
    x: LEFT_X,
    top: consigneeTop,
    width: LEFT_W,
    minHeight: EMPTY_CONSIGNEE_MIN,
  });

  // Note/Notify top shares one Y across columns (no stepped left/right rules).
  // sectionTop = divider Y; drawPairedLabeledBlocks applies DOC_CELL_PAD top+bottom.
  const notifyLabelY = syncDividerY(consigneeBottom, rightBottom);
  const pairBottom = drawPairedLabeledBlocks(
    page,
    regular,
    bold,
    {
      label: 'Notify party:',
      value: dto.notifyParty,
      x: LEFT_X,
      width: LEFT_W,
    },
    { label: 'Note:', value: dto.note, x: RIGHT_X, width: RIGHT_W },
    { sectionTop: notifyLabelY, emptyMinHeight: EMPTY_NOTIFY_MIN },
  );

  const containers = normalizeAnContainersPayload({
    containers: dto.containers,
    cargoRows: dto.cargoRows,
  });
  const volumeText =
    anContainersToVolumeText(containers) || (dto.volume ?? '').trim();
  const descriptionOfGoods = resolveDescriptionOfGoods({
    descriptionOfGoods: dto.descriptionOfGoods,
    containers,
  });

  const marksBottom = drawPairedLabeledBlocks(
    page,
    regular,
    bold,
    { label: 'Marks', value: dto.marks, x: LEFT_X, width: LEFT_W },
    { label: 'Volume', value: volumeText, x: RIGHT_X, width: RIGHT_W },
    { sectionTop: pairBottom, emptyMinHeight: EMPTY_MARKS_MIN },
  );
  const frameBottom = Math.max(marksBottom, PAGE_MIN_BOTTOM);
  drawRule(page, FRAME_LEFT, shipperDividerY, FRAME_RIGHT, shipperDividerY);
  drawRule(page, FRAME_LEFT, pairBottom, FRAME_RIGHT, pairBottom);
  drawRule(page, FRAME_LEFT, marksBottom, FRAME_RIGHT, marksBottom);
  drawRule(page, FRAME_LEFT, headerBottom, FRAME_LEFT, frameBottom);
  drawRule(page, FRAME_MID, headerBottom, FRAME_MID, frameBottom);
  drawRule(page, FRAME_RIGHT, headerBottom, FRAME_RIGHT, frameBottom);
  drawRule(page, FRAME_LEFT, notifyLabelY, FRAME_MID, notifyLabelY);
  if (notifyLabelY > pairBottom + 1) {
    drawRule(page, FRAME_MID, notifyLabelY, FRAME_RIGHT, notifyLabelY);
  }

  const cargoRows =
    containers.length > 0
      ? anContainersToCargoRows(containers, descriptionOfGoods)
      : (dto.cargoRows ?? []);

  finishCargoAndAttentionPage(pdf, page, regular, bold, {
    marksBottom,
    cargoRows,
    title: 'ARRIVAL NOTICE',
    attentionText: dto.customerAttention,
    includeForSeatrans: false,
    pageFloor: PAGE_MIN_BOTTOM,
    cargoHeaderHeight: CARGO_HEADER_HEIGHT,
    cargoMinRowHeight: CARGO_MIN_ROW,
  });
}
