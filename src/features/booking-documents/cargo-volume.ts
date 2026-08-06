/** Booking Confirmation container types (UI / payload order). */
export const BOOKING_CARGO_VOLUME_TYPES = [
  "45'RF",
  "20'DC",
  "40'DC",
  "20'RF",
  "40'RF",
  "20'FR",
  "40'FR",
  "40'HC",
  "45'HC",
  "40'HQ",
] as const;

export type BookingCargoVolumeType =
  (typeof BOOKING_CARGO_VOLUME_TYPES)[number];

export type BookingCargoVolumes = Partial<
  Record<BookingCargoVolumeType, number>
>;

const TYPE_SET = new Set<string>(BOOKING_CARGO_VOLUME_TYPES);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compactBookingCargoVolumes(
  input: Record<string, unknown> | BookingCargoVolumes | null | undefined,
): BookingCargoVolumes {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const next: BookingCargoVolumes = {};
  for (const type of BOOKING_CARGO_VOLUME_TYPES) {
    const raw = (input as Record<string, unknown>)[type];
    const qty =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw)
          : NaN;
    if (Number.isFinite(qty) && qty > 0) {
      next[type] = Math.floor(qty);
    }
  }
  return next;
}

/** PDF tone: one line per type, e.g. `3 x 20'DC`. */
export function formatBookingCargoVolumes(volumes: BookingCargoVolumes): string {
  return BOOKING_CARGO_VOLUME_TYPES.filter((type) => (volumes[type] ?? 0) > 0)
    .map((type) => `${volumes[type]} x ${type}`)
    .join('\n');
}

/** BL description-column first line suffix (official sample style). */
export const BL_VOLUME_STC_SUFFIX = ' CONTAINER(S) S.T.C';

/**
 * Bill of Lading PDF volume line: compact counts without quotes/spaces,
 * plus STC suffix — e.g. `1x20DC CONTAINER(S) S.T.C`.
 * Multiple types join with a space before one shared suffix.
 */
export function formatVolumeForBlPdf(volumes: BookingCargoVolumes): string {
  const parts = BOOKING_CARGO_VOLUME_TYPES.filter(
    (type) => (volumes[type] ?? 0) > 0,
  ).map((type) => `${volumes[type]}x${type.replace(/'/g, '')}`);
  if (parts.length === 0) return '';
  return `${parts.join(' ')}${BL_VOLUME_STC_SUFFIX}`;
}

export function parseBookingCargoVolumeString(
  raw: string | null | undefined,
): BookingCargoVolumes {
  const text = (raw ?? '').trim();
  if (!text) return {};

  const found: BookingCargoVolumes = {};
  for (const type of BOOKING_CARGO_VOLUME_TYPES) {
    const pattern = new RegExp(
      `(\\d+)\\s*[xX×]\\s*${escapeRegExp(type)}`,
      'gi',
    );
    let match: RegExpExecArray | null;
    let total = 0;
    let matched = false;
    while ((match = pattern.exec(text)) !== null) {
      matched = true;
      total += Number(match[1]);
    }
    if (matched && total > 0) {
      found[type] = (found[type] ?? 0) + total;
    }
  }
  return compactBookingCargoVolumes(found);
}

/**
 * Prefer structured cargoVolumes; else parse legacy volume text;
 * else keep the free-text volume for PDF fallback.
 */
export function resolveBookingVolumeDisplay(payload: {
  cargoVolumes?: BookingCargoVolumes | Record<string, unknown> | null;
  volume?: string | null;
}): string {
  const fromStructured = compactBookingCargoVolumes(payload.cargoVolumes);
  if (Object.keys(fromStructured).length > 0) {
    return formatBookingCargoVolumes(fromStructured);
  }
  const fromLegacy = parseBookingCargoVolumeString(payload.volume);
  if (Object.keys(fromLegacy).length > 0) {
    return formatBookingCargoVolumes(fromLegacy);
  }
  return (payload.volume ?? '').trim();
}

export function normalizeBookingCargoVolumePayload(payload: {
  cargoVolumes?: BookingCargoVolumes | Record<string, unknown> | null;
  volume?: string | null;
}): { cargoVolumes: BookingCargoVolumes; volume: string } {
  const fromStructured = compactBookingCargoVolumes(payload.cargoVolumes);
  if (Object.keys(fromStructured).length > 0) {
    return {
      cargoVolumes: fromStructured,
      volume: formatBookingCargoVolumes(fromStructured),
    };
  }
  const fromLegacy = parseBookingCargoVolumeString(payload.volume);
  if (Object.keys(fromLegacy).length > 0) {
    return {
      cargoVolumes: fromLegacy,
      volume: formatBookingCargoVolumes(fromLegacy),
    };
  }
  return {
    cargoVolumes: {},
    volume: (payload.volume ?? '').trim(),
  };
}

export function isBookingCargoVolumeType(
  value: string,
): value is BookingCargoVolumeType {
  return TYPE_SET.has(value);
}
