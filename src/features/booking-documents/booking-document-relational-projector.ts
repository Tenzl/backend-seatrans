import { BookingDocumentType } from './enums/booking-document-type.enum';

const PRESENTATION_KEYS = new Set([
  'descriptionOfGoods',
  'shippingMark',
  'marks',
  'note',
  'notes',
  'specialRemark',
  'to',
  'agent',
  'shipper',
  'consignor',
  'consignee',
  'consignedToOrderOf',
  'notifyParty',
  'notifyAddress',
  'deliverTo',
  'contact',
  'customerAttention',
  'pic',
  'commodity',
  'commodityType',
  'commodityName',
  'volume',
  'numberAndKindOfPackages',
  'cargoRows',
  'notifyPartySameAsConsignee',
  'billOfLadingType',
  'cargoInsurance',
  'blFormVariant',
  'declarationOfInterest',
  'declaredValue',
  'deliveryApplyTo',
  'numberOfOriginals',
  'placeOfReceipt',
  'portOfLoading',
  'placeOfIssue',
  'pickupPlace',
  'portOfDischarge',
  'placeOfDelivery',
  'dropoffPlace',
  'transitPort',
  'finalDestination',
]);

export function isPresentationField(key: string): boolean {
  return PRESENTATION_KEYS.has(key);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function id(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseReportNumber(value: unknown): {
  numeric: string | null;
  raw: string | null;
} {
  const raw = text(value);
  if (!raw) return { numeric: null, raw: null };
  const match = raw.replace(/,/g, '').match(/[-+]?\d+(?:\.\d+)?/);
  return { numeric: match?.[0] ?? null, raw };
}

export function projectRelationalFields(
  type: BookingDocumentType,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const presentationPayload = Object.fromEntries(
    Object.entries(payload).filter(([key]) => PRESENTATION_KEYS.has(key)),
  );
  const common = { presentationPayload, presentationSchemaVersion: 1 };
  if (type === BookingDocumentType.BOOKING_CONFIRMATION) {
    const gross = parseReportNumber(payload.grossWeight);
    const measurement = parseReportNumber(payload.measurement);
    return {
      ...common,
      documentNumberV2: text(payload.bookingNumber),
      documentDate: text(payload.date),
      clientPartyId: id(payload.clientPartyId),
      placeOfReceiptPortId: id(payload.placeOfReceiptPortId),
      portOfLoadingId: id(payload.portOfLoadingPortId),
      placeOfIssuePortId: id(payload.placeOfIssuePortId),
      pickupPortId: id(payload.pickupPlacePortId),
      portOfDischargeId: id(payload.portOfDischargePortId),
      placeOfDeliveryPortId: id(payload.placeOfDeliveryPortId),
      dropoffPortId: id(payload.dropoffPlacePortId),
      transitPortId: id(payload.transitPortId),
      vesselVoyageText: text(payload.vesselVoyage),
      etd: text(payload.etd),
      eta: text(payload.eta),
      pickupDate: text(payload.pickupDate),
      closingTime: text(payload.closingTime),
      siCutoff: text(payload.siCutoff),
      vgmCutoff: text(payload.vgmCutoff),
      commodityTypeId: id(payload.commodityTypeId),
      commodityId: id(payload.commodityId),
      grossWeightKg: gross.numeric,
      grossWeightRaw: gross.raw,
      measurementCbm: measurement.numeric,
      measurementRaw: measurement.raw,
      motherVessel: text(payload.motherVessel),
      motherVoyage: text(payload.motherVoyage),
      picUserId: id(payload.picUserId),
    };
  }
  if (type === BookingDocumentType.BILL_OF_LADING) {
    const gross = parseReportNumber(payload.grossWeight);
    const measurement = parseReportNumber(payload.measurement);
    const freightAmount = parseReportNumber(payload.freightAmount);
    return {
      ...common,
      documentNumberV2: text(payload.fblNumber),
      documentDate: text(payload.dateOfIssue),
      shipperPartyId: id(payload.shipperPartyId),
      consigneePartyId: id(payload.consigneePartyId),
      notifyPartyId: id(payload.notifyPartyId),
      placeOfReceiptPortId: id(payload.placeOfReceiptPortId),
      portOfLoadingId: id(payload.portOfLoadingPortId),
      portOfDischargeId: id(payload.portOfDischargePortId),
      placeOfDeliveryPortId: id(payload.placeOfDeliveryPortId),
      placeOfIssuePortId: id(payload.placeOfIssuePortId),
      oceanVesselText: text(payload.oceanVessel),
      serviceMode: text(payload.serviceMode),
      grossWeightKg: gross.numeric,
      grossWeightRaw: gross.raw,
      measurementCbm: measurement.numeric,
      measurementRaw: measurement.raw,
      freightTerms: text(payload.freightTerms),
      cleanOnBoardDate: text(payload.cleanOnBoardDate),
      freightAmount: freightAmount.numeric,
      freightAmountRaw: freightAmount.raw,
      freightPayableAt: text(payload.freightPayableAt),
    };
  }
  return {
    ...common,
    documentNumberV2: text(
      payload[
        type === BookingDocumentType.ARRIVAL_NOTICE ? 'anNumber' : 'doNumber'
      ],
    ),
    documentDate: text(payload.date),
    agentPartyId: id(payload.agentPartyId),
    shipperPartyId: id(payload.shipperPartyId),
    consigneePartyId: id(payload.consigneePartyId),
    notifyPartyId: id(payload.notifyPartyId),
    masterBillNumberV2: text(payload.mblNumber),
    houseBillNumberV2: text(payload.hblNumber),
    shipmentNumberV2: text(payload.shipmentNumber),
    ...(type === BookingDocumentType.ARRIVAL_NOTICE
      ? { referenceNumberV2: text(payload.referenceNumber) }
      : {}),
    placeOfReceiptPortId: id(payload.placeOfReceiptPortId),
    portOfLoadingId: id(payload.portOfLoadingPortId),
    portOfDischargeId: id(payload.portOfDischargePortId),
    placeOfDeliveryPortId: id(payload.placeOfDeliveryPortId),
    finalDestinationPortId: id(payload.finalDestinationPortId),
    vesselVoyageText: text(payload.vesselVoyage),
    etd: text(payload.etd),
    eta: text(payload.eta),
    serviceMode: text(payload.serviceMode),
    cfsTerminal: text(payload.cfsTerminal),
    ...(type === BookingDocumentType.ARRIVAL_NOTICE
      ? {
          commodityTypeId: id(payload.commodityTypeId),
          commodityId: id(payload.commodityId),
        }
      : {}),
  };
}

export function nonBlankCargoVolumes(
  payload: Record<string, unknown>,
): Array<{ containerTypeCode: string; quantity: number; rowOrder: number }> {
  const source = payload.cargoVolumes;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
  const rows: Array<{
    containerTypeCode: string;
    quantity: number;
    rowOrder: number;
  }> = [];
  for (const [containerTypeCode, quantity] of Object.entries(
    source as Record<string, unknown>,
  )) {
    if (
      containerTypeCode.trim() &&
      typeof quantity === 'number' &&
      quantity > 0
    ) {
      rows.push({ containerTypeCode, quantity, rowOrder: rows.length });
    }
  }
  return rows;
}

export function nonBlankContainers(
  payload: Record<string, unknown>,
): Record<string, unknown>[] {
  if (!Array.isArray(payload.containers)) return [];
  const containers = payload.containers as unknown[];
  return containers.filter(
    (row): row is Record<string, unknown> =>
      row !== null &&
      typeof row === 'object' &&
      Object.values(row as Record<string, unknown>).some((value) =>
        typeof value === 'number'
          ? value !== 0
          : typeof value === 'string' && value.trim() !== '',
      ),
  );
}
