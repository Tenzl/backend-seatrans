const PRESENTATION_KEYS = new Set([
  'descriptionOfGoods', 'shippingMark', 'marks', 'note', 'notes',
  'specialRemark', 'to', 'agent', 'shipper', 'consignor', 'consignee',
  'consignedToOrderOf', 'notifyParty', 'notifyAddress', 'deliverTo',
  'contact', 'customerAttention', 'pic', 'commodity', 'commodityType',
  'commodityName', 'volume', 'numberAndKindOfPackages', 'cargoRows',
  'notifyPartySameAsConsignee', 'billOfLadingType', 'cargoInsurance',
  'blFormVariant', 'declarationOfInterest', 'declaredValue',
  'deliveryApplyTo', 'numberOfOriginals',
  'placeOfReceipt', 'portOfLoading', 'placeOfIssue', 'pickupPlace',
  'portOfDischarge', 'placeOfDelivery', 'dropoffPlace', 'transitPort',
  'finalDestination',
]);

export function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseLegacyNumber(value) {
  const raw = cleanText(value);
  if (!raw) return { value: null, raw: null };
  const normalized = raw.replace(/,/g, '');
  const match = normalized.match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return { value: null, raw };
  const parsed = Number(match[0]);
  return { value: Number.isFinite(parsed) ? parsed : null, raw };
}

export function presentationFromPayload(payload) {
  return Object.fromEntries(
    Object.entries(payload ?? {}).filter(
      ([key, value]) => PRESENTATION_KEYS.has(key) && value !== undefined,
    ),
  );
}

function positiveInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0)
    return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

export function cargoVolumesFromPayload(payload) {
  const volumes = payload?.cargoVolumes;
  if (!volumes || typeof volumes !== 'object' || Array.isArray(volumes))
    return [];
  return Object.entries(volumes)
    .map(([containerTypeCode, quantity]) => ({
      containerTypeCode: cleanText(containerTypeCode),
      quantity: positiveInteger(quantity),
    }))
    .filter((row) => row.containerTypeCode && row.quantity)
    .map((row, rowOrder) => ({ ...row, rowOrder }));
}

export function containersFromPayload(payload) {
  if (!Array.isArray(payload?.containers)) return [];
  return payload.containers
    .map((source) => {
      const row = source && typeof source === 'object' ? source : {};
      const grossWeight = parseLegacyNumber(row.grossWeight);
      const measurement = parseLegacyNumber(row.measurement);
      const tare = parseLegacyNumber(row.tare);
      const packages = parseLegacyNumber(row.noOfPkgs);
      return {
        containerTypeCode: cleanText(row.type),
        containerNo: cleanText(row.containerNo),
        sealNo: cleanText(row.sealNo),
        grossWeightKg: grossWeight.value,
        grossWeightRaw: grossWeight.raw,
        measurementCbm: measurement.value,
        measurementRaw: measurement.raw,
        tareKg: tare.value,
        tareRaw: tare.raw,
        packageTypeId: positiveInteger(row.packageTypeId),
        packageTypeSnapshot: cleanText(row.packageType),
        numberOfPackages: Number.isInteger(packages.value)
          ? packages.value
          : null,
        numberOfPackagesRaw: packages.raw,
        method: cleanText(row.method),
        presentation: cleanText(row.note) ? { note: cleanText(row.note) } : {},
      };
    })
    .filter((row) =>
      [row.containerTypeCode, row.containerNo, row.sealNo,
       row.grossWeightRaw, row.measurementRaw, row.tareRaw,
       row.packageTypeSnapshot, row.numberOfPackagesRaw, row.method,
       row.presentation.note].some(Boolean),
    )
    .map((row, rowOrder) => ({ ...row, rowOrder }));
}

export function scalarProjection(type, payload) {
  const gross = parseLegacyNumber(payload?.grossWeight);
  const measurement = parseLegacyNumber(payload?.measurement);
  const common = {
    presentationPayload: presentationFromPayload(payload),
    presentationSchemaVersion: 1,
  };
  if (type === 'booking') return {
    ...common,
    documentNumber: cleanText(payload.bookingNumber),
    documentDate: cleanText(payload.date), clientPartyId: positiveInteger(payload.clientPartyId),
    vesselVoyageText: cleanText(payload.vesselVoyage), etd: cleanText(payload.etd), eta: cleanText(payload.eta),
    pickupDate: cleanText(payload.pickupDate), closingTime: cleanText(payload.closingTime),
    siCutoff: cleanText(payload.siCutoff), vgmCutoff: cleanText(payload.vgmCutoff),
    commodityTypeId: positiveInteger(payload.commodityTypeId), commodityId: positiveInteger(payload.commodityId),
    grossWeightKg: gross.value, grossWeightRaw: gross.raw,
    measurementCbm: measurement.value, measurementRaw: measurement.raw,
    motherVessel: cleanText(payload.motherVessel), motherVoyage: cleanText(payload.motherVoyage),
    picUserId: positiveInteger(payload.picUserId),
  };
  if (type === 'bl') {
    const freight = parseLegacyNumber(payload.freightAmount);
    return { ...common, documentNumber: cleanText(payload.fblNumber),
      documentDate: cleanText(payload.dateOfIssue), shipperPartyId: positiveInteger(payload.shipperPartyId),
      consigneePartyId: positiveInteger(payload.consigneePartyId), notifyPartyId: positiveInteger(payload.notifyPartyId),
      oceanVesselText: cleanText(payload.oceanVessel), serviceMode: cleanText(payload.serviceMode),
      grossWeightKg: gross.value, grossWeightRaw: gross.raw,
      measurementCbm: measurement.value, measurementRaw: measurement.raw,
      freightTerms: cleanText(payload.freightTerms), cleanOnBoardDate: cleanText(payload.cleanOnBoardDate),
      freightAmount: freight.value, freightAmountRaw: freight.raw,
      freightPayableAt: cleanText(payload.freightPayableAt) };
  }
  const prefix = type === 'an' ? 'anNumber' : 'doNumber';
  return { ...common, documentNumber: cleanText(payload[prefix]), documentDate: cleanText(payload.date),
    agentPartyId: positiveInteger(payload.agentPartyId), shipperPartyId: positiveInteger(payload.shipperPartyId),
    consigneePartyId: positiveInteger(payload.consigneePartyId), notifyPartyId: positiveInteger(payload.notifyPartyId),
    masterBillNumber: cleanText(payload.mblNumber), houseBillNumber: cleanText(payload.hblNumber),
    shipmentNumber: cleanText(payload.shipmentNumber), referenceNumber: cleanText(payload.referenceNumber),
    vesselVoyageText: cleanText(payload.vesselVoyage), etd: cleanText(payload.etd), eta: cleanText(payload.eta),
    serviceMode: cleanText(payload.serviceMode), cfsTerminal: cleanText(payload.cfsTerminal),
    commodityTypeId: positiveInteger(payload.commodityTypeId), commodityId: positiveInteger(payload.commodityId) };
}

export const presentationKeys = Object.freeze([...PRESENTATION_KEYS]);
