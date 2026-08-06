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

/** Target display: "07 Aug 2026 17:00" (day month year, optional 24h time). */
const DISPLAY_RE =
  /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/;

const SLASH_DATE_RE =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/;

const ISO_DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

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
): string {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return '';
  }
  const date = `${pad2(day)} ${MONTHS[month - 1]} ${year}`;
  if (hours != null && minutes != null) {
    return `${date} ${pad2(hours)}:${pad2(minutes)}`;
  }
  return date;
}

function parseDisplayDate(raw: string): string {
  const match = DISPLAY_RE.exec(raw);
  if (!match) return '';
  const [, dayText, monthText, yearText, hourText, minuteText] = match;
  const month = monthIndex(monthText);
  if (month < 0) return '';
  return formatParts(
    Number(dayText),
    month + 1,
    Number(yearText),
    hourText != null ? Number(hourText) : undefined,
    minuteText != null ? Number(minuteText) : undefined,
  );
}

function parseSlashDate(raw: string): string {
  const match = SLASH_DATE_RE.exec(raw);
  if (!match) return '';
  const [, dayText, monthText, yearText, hourText, minuteText] = match;
  return formatParts(
    Number(dayText),
    Number(monthText),
    Number(yearText),
    hourText != null ? Number(hourText) : undefined,
    minuteText != null ? Number(minuteText) : undefined,
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
      );
    }
  }

  const match = ISO_DATE_RE.exec(raw);
  if (!match) return '';
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  return formatParts(
    Number(dayText),
    Number(monthText),
    Number(yearText),
    hourText != null ? Number(hourText) : undefined,
    minuteText != null ? Number(minuteText) : undefined,
  );
}

/**
 * Format ETD/ETA (and similar schedule fields) for booking PDF output.
 * Returns an empty string when the input is blank or only whitespace.
 */
export function formatBookingPdfDateTime(value?: string): string {
  const raw = stripScheduleLabel(value ?? '');
  if (!raw) return '';

  return (
    parseDisplayDate(raw) ||
    parseSlashDate(raw) ||
    parseIsoDate(raw) ||
    raw
  );
}
