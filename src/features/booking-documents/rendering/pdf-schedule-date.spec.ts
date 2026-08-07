import { formatPdfDateTime, stripScheduleLabel } from './pdf-schedule-date';

describe('formatPdfDateTime', () => {
  it('returns empty for blank values', () => {
    expect(formatPdfDateTime('')).toBe('');
    expect(formatPdfDateTime('   ')).toBe('');
    expect(formatPdfDateTime(undefined)).toBe('');
    expect(formatPdfDateTime(null)).toBe('');
  });

  it('formats dd/MM/yyyy with optional 24h time and seconds', () => {
    expect(formatPdfDateTime('14/06/2026')).toBe('Jun 14, 2026');
    expect(formatPdfDateTime('07/08/2026 17:00')).toBe(
      'Aug 07, 2026 17:00:00',
    );
    expect(formatPdfDateTime('30/06/2026 08:00:00')).toBe(
      'Jun 30, 2026 08:00:00',
    );
  });

  it('formats ISO date and datetime values', () => {
    expect(formatPdfDateTime('2026-08-06')).toBe('Aug 06, 2026');
    expect(formatPdfDateTime('2026-06-01T08:00:00Z')).toBe(
      'Jun 01, 2026 08:00:00',
    );
    expect(formatPdfDateTime('2026-08-07T17:00:00')).toBe(
      'Aug 07, 2026 17:00:00',
    );
  });

  it('normalizes already formatted values (legacy and new)', () => {
    expect(formatPdfDateTime('7 Aug 2026')).toBe('Aug 07, 2026');
    expect(formatPdfDateTime('07 Aug 2026 17:00')).toBe(
      'Aug 07, 2026 17:00:00',
    );
    expect(formatPdfDateTime('Jun 30, 2026')).toBe('Jun 30, 2026');
    expect(formatPdfDateTime('Jun 30, 2026 08:00:00')).toBe(
      'Jun 30, 2026 08:00:00',
    );
  });

  it('strips ETD/ETA prefixes before formatting', () => {
    expect(formatPdfDateTime('ETD: 14/06/2026')).toBe('Jun 14, 2026');
    expect(formatPdfDateTime('ETA 07/08/2026 17:00')).toBe(
      'Aug 07, 2026 17:00:00',
    );
  });

  it('omits time when input has no time component', () => {
    expect(formatPdfDateTime('2026-06-30')).toBe('Jun 30, 2026');
    expect(formatPdfDateTime('30/06/2026')).toBe('Jun 30, 2026');
  });
});

describe('stripScheduleLabel', () => {
  it('removes leading ETD/ETA labels', () => {
    expect(stripScheduleLabel('ETD 14 Aug 2026')).toBe('14 Aug 2026');
    expect(stripScheduleLabel('ETA: 2026-08-12')).toBe('2026-08-12');
  });
});
