import { rgb } from 'pdf-lib';
import { ArrivalNoticePreviewDto } from '../dto/arrival-notice-preview.dto';
import { BookingDocumentRenderContext } from './booking-document-render-context';
import {
  BELOW_RULE_BASELINE,
  columnValueLayout,
  DETAIL_LABEL_SIZE,
  DOC_BODY_TEXT_SIZE,
  DOC_CELL_PAD,
  DOC_FRAME_LEFT,
  DOC_FRAME_MID,
  DOC_FRAME_RIGHT,
  DOC_HEADER_BOTTOM,
  DOC_HEADER_TOP,
  DOC_LABEL_GAP,
  DOC_LEFT_W,
  DOC_LEFT_X,
  DOC_RIGHT_W,
  DOC_RIGHT_X,
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
  LabelValuePair,
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
  'ETD/ETA:',
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

  drawMetaHeaderRow(page, regular, bold, {
    left: { label: 'Agent:', value: dto.agent },
    mid: { label: 'Date:', value: dto.date },
    right: { label: 'AN No.:', value: dto.anNumber },
  });

  const { valueX, valueWidth } = columnValueLayout(
    RIGHT_X,
    FRAME_RIGHT - FRAME_TEXT_INSET,
    RIGHT_LABELS,
    bold,
  );

  drawTextBlock(
    page,
    regular,
    bold,
    'We are pleased to inform that you have an incoming shipment with details as follows:',
    {
      x: RIGHT_X,
      top: 671,
      width: FRAME_RIGHT - FRAME_TEXT_INSET - RIGHT_X,
      size: TEXT_SIZE,
    },
  );

  // Right groups beside Shipper (MBL…Type of B/L), then sync divider with Shipper bottom.
  let rightY = 638;
  const shipperSideGroups: LabelValuePair[][] = [
    [
      ['MBL No.:', dto.mblNumber],
      ['HBL No.:', dto.hblNumber],
    ],
    [
      ['Vessel/Voyage No.:', dto.vesselVoyage],
      ['ETD/ETA:', dto.etdEta],
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
      valueSize: DOC_BODY_TEXT_SIZE,
    });
  });
  const rightShipperDividerY = rightY + 4;

  const shipperBottom = drawLabeledBlock(page, regular, bold, {
    label: 'Shipper:',
    labelY: 663,
    value: dto.shipper,
    x: LEFT_X,
    top: 660,
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

  const marksBottom = drawPairedLabeledBlocks(
    page,
    regular,
    bold,
    { label: 'Marks', value: dto.marks, x: LEFT_X, width: LEFT_W },
    { label: 'Volume', value: dto.volume, x: RIGHT_X, width: RIGHT_W },
    { sectionTop: pairBottom, emptyMinHeight: EMPTY_MARKS_MIN },
  );
  const frameBottom = Math.max(marksBottom, PAGE_MIN_BOTTOM);
  drawRule(page, FRAME_LEFT, shipperDividerY, FRAME_RIGHT, shipperDividerY);
  drawRule(page, FRAME_LEFT, pairBottom, FRAME_RIGHT, pairBottom);
  drawRule(page, FRAME_LEFT, marksBottom, FRAME_RIGHT, marksBottom);
  drawRule(page, FRAME_LEFT, DOC_HEADER_BOTTOM, FRAME_LEFT, frameBottom);
  drawRule(page, FRAME_MID, DOC_HEADER_BOTTOM, FRAME_MID, frameBottom);
  drawRule(page, FRAME_RIGHT, DOC_HEADER_BOTTOM, FRAME_RIGHT, frameBottom);
  drawRule(page, FRAME_LEFT, notifyLabelY, FRAME_MID, notifyLabelY);
  if (notifyLabelY > pairBottom + 1) {
    drawRule(page, FRAME_MID, notifyLabelY, FRAME_RIGHT, notifyLabelY);
  }

  finishCargoAndAttentionPage(pdf, page, regular, bold, {
    marksBottom,
    cargoRows: dto.cargoRows,
    title: 'ARRIVAL NOTICE',
    attentionText: dto.customerAttention,
    includeForSeatrans: false,
    pageFloor: PAGE_MIN_BOTTOM,
    cargoHeaderHeight: CARGO_HEADER_HEIGHT,
    cargoMinRowHeight: CARGO_MIN_ROW,
  });
}
