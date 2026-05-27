import { ServiceInquiry } from '../entities/service-inquiry.entity';

export type InquiryResponseAudience = 'user' | 'admin';

function shippingAgencySharedFields(row: ServiceInquiry): Record<string, unknown> {
  return {
    toName: row.toName,
    mv: row.mv,
    eta: row.eta,
    dwt: row.dwt,
    grt: row.grt,
    loa: row.loa,
    cargoType: row.cargoType,
    cargoName: row.cargoName,
    cargoNameOther: row.cargoNameOther,
    cargoQuantity: row.cargoQuantity,
    portOfCall: row.portOfCall,
    dischargeLoadingLocation: row.dischargeLoadingLocation,
    otherInfo: row.otherInfo,
    transportLs: row.transportLs,
    transportQuarantine: row.transportQuarantine,
    frtTaxType: row.frtTaxType,
    purposeOfCalling: row.purposeOfCalling,
    boatHireAmount: row.boatHireAmount,
    tallyFeeAmount: row.tallyFeeAmount,
    quoteForm: row.quoteForm,
  };
}

function shippingAgencyInternalEpdaFields(row: ServiceInquiry): Record<string, unknown> {
  return {
    epdaDocumentDate: row.epdaDocumentDate,
    shipType: row.shipType,
    oceanFrtRateUsdPerMt: row.oceanFrtRateUsdPerMt,
    garbageCbmAmount: row.garbageCbmAmount,
    quarantineCargoMode: row.quarantineCargoMode,
    agencyFeeMode: row.agencyFeeMode,
    agencyDiscountPercent: row.agencyDiscountPercent,
    agencyLumpsumAmount: row.agencyLumpsumAmount,
    berthHours: row.berthHours,
    anchorageHours: row.anchorageHours,
    pilotage3rdMiles: row.pilotage3rdMiles,
    epdaSnapshot: row.epdaSnapshot,
    quotedAt: row.quotedAt,
    quotedByUserId: row.quotedByUserId,
    createdSource: row.createdSource,
    processedById: row.processedById,
  };
}

export function mapShippingAgencyInquiryFields(
  row: ServiceInquiry,
  audience: InquiryResponseAudience,
): Record<string, unknown> {
  const shared = shippingAgencySharedFields(row);

  if (audience === 'user') {
    return {
      ...shared,
      quoteAvailable: row.quotedAt != null && row.status === 'QUOTED',
    };
  }

  return {
    ...shared,
    ...shippingAgencyInternalEpdaFields(row),
  };
}
