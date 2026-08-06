import { formatBookingPdfDateTime, stripScheduleLabel } from './pdf-schedule-date';

describe('formatBookingPdfDateTime', () => {
  it('returns empty for blank values', () => {
    expect(formatBookingPdfDateTime('')).toBe('');
    expect(formatBookingPdfDateTime('   ')).toBe('');
    expect(formatBookingPdfDateTime(undefined)).toBe('');
  });

  it('formats dd/MM/yyyy with optional 24h time', () => {
    expect(formatBookingPdfDateTime('14/06/2026')).toBe('14 Jun 2026');
    expect(formatBookingPdfDateTime('07/08/2026 17:00')).toBe('07 Aug 2026 17:00');
  });

  it('formats ISO date and datetime values', () => {
    expect(formatBookingPdfDateTime('2026-08-06')).toBe('06 Aug 2026');
    expect(formatBookingPdfDateTime('2026-06-01T08:00:00Z')).toBe(
      '01 Jun 2026 08:00',
    );
  });

  it('normalizes already formatted values', () => {
    expect(formatBookingPdfDateTime('7 Aug 2026')).toBe('07 Aug 2026');
    expect(formatBookingPdfDateTime('07 Aug 2026 17:00')).toBe(
      '07 Aug 2026 17:00',
    );
  });

  it('strips ETD/ETA prefixes before formatting', () => {
    expect(formatBookingPdfDateTime('ETD: 14/06/2026')).toBe('14 Jun 2026');
    expect(formatBookingPdfDateTime('ETA 07/08/2026 17:00')).toBe(
      '07 Aug 2026 17:00',
    );
  });
});

describe('stripScheduleLabel', () => {
  it('removes leading ETD/ETA labels', () => {
    expect(stripScheduleLabel('ETD 14 Aug 2026')).toBe('14 Aug 2026');
    expect(stripScheduleLabel('ETA: 2026-08-12')).toBe('2026-08-12');
  });
});
