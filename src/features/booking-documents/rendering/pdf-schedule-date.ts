const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Canonical PDF datetime display:
 *   with time → "Jun 30, 2026 08:00:00" (MMM DD, YYYY HH:mm:ss)
 *   date only → "Jun 30, 2026" (MMM DD, YYYY)
 */
const NEW_DISPLAY_RE =
  /^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/** Legacy display: "07 Aug 2026 17:00" / "07 Aug 2026 17:00:00". */
const LEGACY_DISPLAY_RE =
  /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

const SLASH_DATE_RE =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

const ISO_DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Strip a leading ETD/ETA label from a stored schedule value. */
export function stripScheduleLabel(value: string): string {
  return value.replace(/^\s*(ETD|ETA)\b[:\s-]*/i, '').trim();
}

function monthIndex(abbrev: string): number {
  return MONTHS.findIndex(
    (month) => month.toLowerCase() === abbrev.toLowerCase(),
  );
}

function formatParts(
  day: number,
  month: number,
  year: number,
  hours?: number,
  minutes?: number,
  seconds?: number,
): string {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return '';
  }
  const date = `${MONTHS[month - 1]} ${pad2(day)}, ${year}`;
  if (hours != null && minutes != null) {
    return `${date} ${pad2(hours)}:${pad2(minutes)}:${pad2(seconds ?? 0)}`;
  }
  return date;
}

function parseNewDisplayDate(raw: string): string {
  const match = NEW_DISPLAY_RE.exec(raw);
  if (!match) return '';
  const [, monthText, dayText, yearText, hourText, minuteText, secondText] =
    match;
  const month = monthIndex(monthText);
  if (month < 0) return '';
  return formatParts(
    Number(dayText),
    month + 1,
    Number(yearText),
    hourText != null ? Number(hourText) : undefined,
    minuteText != null ? Number(minuteText) : undefined,
    secondText != null ? Number(secondText) : hourText != null ? 0 : undefined,
  );
}

function parseLegacyDisplayDate(raw: string): string {
  const match = LEGACY_DISPLAY_RE.exec(raw);
  if (!match) return '';
  const [, dayText, monthText, yearText, hourText, minuteText, secondText] =
    match;
  const month = monthIndex(monthText);
  if (month < 0) return '';
  return formatParts(
    Number(dayText),
    month + 1,
    Number(yearText),
    hourText != null ? Number(hourText) : undefined,
    minuteText != null ? Number(minuteText) : undefined,
    secondText != null ? Number(secondText) : hourText != null ? 0 : undefined,
  );
}

function parseSlashDate(raw: string): string {
  const match = SLASH_DATE_RE.exec(raw);
  if (!match) return '';
  const [, dayText, monthText, yearText, hourText, minuteText, secondText] =
    match;
  return formatParts(
    Number(dayText),
    Number(monthText),
    Number(yearText),
    hourText != null ? Number(hourText) : undefined,
    minuteText != null ? Number(minuteText) : undefined,
    secondText != null ? Number(secondText) : hourText != null ? 0 : undefined,
  );
}

function parseIsoDate(raw: string): string {
  const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (raw.includes('T') && hasExplicitTimezone) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return formatParts(
        parsed.getUTCDate(),
        parsed.getUTCMonth() + 1,
        parsed.getUTCFullYear(),
        parsed.getUTCHours(),
        parsed.getUTCMinutes(),
        parsed.getUTCSeconds(),
      );
    }
  }

  const match = ISO_DATE_RE.exec(raw);
  if (!match) return '';
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  return formatParts(
    Number(dayText),
    Number(monthText),
    Number(yearText),
    hourText != null ? Number(hourText) : undefined,
    minuteText != null ? Number(minuteText) : undefined,
    secondText != null ? Number(secondText) : hourText != null ? 0 : undefined,
  );
}

/**
 * Shared formatter for every date/time shown on booking-document PDFs.
 * Returns an empty string when the input is blank or only whitespace.
 */
export function formatPdfDateTime(value?: string | null): string {
  const raw = stripScheduleLabel(value ?? '');
  if (!raw) return '';

  return (
    parseNewDisplayDate(raw) ||
    parseLegacyDisplayDate(raw) ||
    parseSlashDate(raw) ||
    parseIsoDate(raw) ||
    raw
  );
}

/** @deprecated Prefer {@link formatPdfDateTime}. */
export const formatBookingPdfDateTime = formatPdfDateTime;
