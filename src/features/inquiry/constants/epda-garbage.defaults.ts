export const DEFAULT_GARBAGE_CBM_AMOUNT = 1
export const DEFAULT_GARBAGE_USD_QN = 17
export const DEFAULT_GARBAGE_USD_HCM = 54

export function getDefaultGarbageUsdRate(quoteForm?: string | null): number {
  return quoteForm?.toUpperCase() === 'QN' ? DEFAULT_GARBAGE_USD_QN : DEFAULT_GARBAGE_USD_HCM
}

export function resolveGarbageUsdRate(
  quoteForm: string | null | undefined,
  stored: string | number | null | undefined,
): string {
  if (stored != null && String(stored).trim() !== '') {
    const parsed = Number(stored)
    if (Number.isFinite(parsed) && parsed > 0) {
      return String(stored)
    }
  }
  return String(getDefaultGarbageUsdRate(quoteForm))
}

export function resolveGarbageCbmAmount(stored: string | number | null | undefined): string {
  if (stored != null && String(stored).trim() !== '') {
    const parsed = Number(stored)
    if (Number.isFinite(parsed) && parsed > 0) {
      return String(stored)
    }
  }
  return String(DEFAULT_GARBAGE_CBM_AMOUNT)
}
