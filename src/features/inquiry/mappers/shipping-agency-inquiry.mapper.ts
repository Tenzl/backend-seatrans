import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';
import { resolveGarbageUsdRate } from '../constants/epda-garbage.defaults';

export type InquiryResponseAudience = 'user' | 'admin';

function shippingAgencySharedFields(
  row: ShippingAgencyInquiryEntity,
): Record<string, unknown> {
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
    portId: row.portId,
    portOfCall: row.portOfCall,
    dischargeLoadingLocation: row.dischargeLoadingLocation,
    otherInfo: row.otherInfo,
    transportLs: row.transportLs,
    transportQuarantine: row.transportQuarantine,
    frtTaxType: row.frtTaxType,
    purposeOfCalling: row.purposeOfCalling,
    boatHireAmount: row.boatHireAmount,
    tallyFeeAmount: row.tallyFeeAmount,
    tugAssistanceAmount: row.tugAssistanceAmount,
    shorecraneHireUsdPerMt: row.shorecraneHireUsdPerMt,
    quoteForm: row.quoteForm,
  };
}

function shippingAgencyInternalEpdaFields(
  row: ShippingAgencyInquiryEntity,
): Record<string, unknown> {
  return {
    epdaDocumentDate: row.epdaDocumentDate,
    shipType: row.shipType,
    shipownerNationality: row.shipownerNationality,
    oceanFrtRateUsdPerMt: row.oceanFrtRateUsdPerMt,
    garbageUsdRate: resolveGarbageUsdRate(row.quoteForm, row.garbageUsdRate),
    quarantineCargoMode: row.quarantineCargoMode,
    agencyFeeMode: row.agencyFeeMode,
    agencyDiscountPercent: row.agencyDiscountPercent,
    agencyLumpsumAmount: row.agencyLumpsumAmount,
    agencyOtherExpenses: row.agencyOtherExpenses,
    tugAssistanceTrips: row.tugAssistanceTrips,
    berthHours: row.berthHours,
    anchorageHours: row.anchorageHours,
    pilotage3rdMiles: row.pilotage3rdMiles,
    epdaSnapshot: row.epdaSnapshot,
    epdaWorkingParams: row.epdaWorkingParams,
    epdaLockedAt: row.epdaLockedAt,
    quotedAt: row.quotedAt,
    quotedByUserId: row.quotedByUserId,
    createdSource: row.createdSource,
    customerSubmittedSnapshot: row.customerSubmittedSnapshot,
    processedById: row.processedById,
  };
}

export function mapShippingAgencyInquiryFields(
  row: ShippingAgencyInquiryEntity,
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
