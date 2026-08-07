import {
  formatEtdEtaForPdf,
  formatScheduleDateForPdf,
  resolveArrivalNoticeSchedule,
} from './arrival-notice.renderer';

describe('formatEtdEtaForPdf', () => {
  it('strips ETD/ETA prefixes and formats each date', () => {
    expect(formatEtdEtaForPdf('ETD 14 Aug 2026 / ETA 22 Aug 2026')).toBe(
      'Aug 14, 2026 / Aug 22, 2026',
    );
  });

  it('normalizes bare and ISO dates', () => {
    expect(formatEtdEtaForPdf('14 Aug 2026 / 22 Aug 2026')).toBe(
      'Aug 14, 2026 / Aug 22, 2026',
    );
    expect(formatEtdEtaForPdf('2026-08-14 / 2026-08-22')).toBe(
      'Aug 14, 2026 / Aug 22, 2026',
    );
  });

  it('handles single side and empty input', () => {
    expect(formatEtdEtaForPdf('ETD 14 Aug 2026')).toBe('Aug 14, 2026');
    expect(formatEtdEtaForPdf('')).toBe('');
    expect(formatEtdEtaForPdf(undefined)).toBe('');
  });
});

describe('resolveArrivalNoticeSchedule', () => {
  it('prefers split etd/eta fields', () => {
    expect(
      resolveArrivalNoticeSchedule({
        etd: '2026-08-06',
        eta: '2026-08-12',
        etdEta: 'ignored / legacy',
      }),
    ).toEqual({ etd: 'Aug 06, 2026', eta: 'Aug 12, 2026' });
  });

  it('falls back to legacy combined etdEta', () => {
    expect(
      resolveArrivalNoticeSchedule({
        etdEta: 'ETD 14 Aug 2026 / ETA 22 Aug 2026',
      }),
    ).toEqual({ etd: 'Aug 14, 2026', eta: 'Aug 22, 2026' });
  });

  it('formats single schedule dates via shared lib', () => {
    expect(formatScheduleDateForPdf('ETD 2026-08-06')).toBe('Aug 06, 2026');
    expect(formatScheduleDateForPdf('ETA: 2026-08-12')).toBe('Aug 12, 2026');
  });
});
