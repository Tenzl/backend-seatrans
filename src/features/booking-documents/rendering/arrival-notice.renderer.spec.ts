import {
  formatEtdEtaForPdf,
  formatScheduleDateForPdf,
  resolveArrivalNoticeSchedule,
} from './arrival-notice.renderer';

describe('formatEtdEtaForPdf', () => {
  it('strips ETD/ETA prefixes before each date', () => {
    expect(formatEtdEtaForPdf('ETD 14 Aug 2026 / ETA 22 Aug 2026')).toBe(
      '14 Aug 2026 / 22 Aug 2026',
    );
  });

  it('leaves bare dates unchanged', () => {
    expect(formatEtdEtaForPdf('14 Aug 2026 / 22 Aug 2026')).toBe(
      '14 Aug 2026 / 22 Aug 2026',
    );
    expect(formatEtdEtaForPdf('2026-08-14 / 2026-08-22')).toBe(
      '2026-08-14 / 2026-08-22',
    );
  });

  it('handles single side and empty input', () => {
    expect(formatEtdEtaForPdf('ETD 14 Aug 2026')).toBe('14 Aug 2026');
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
    ).toEqual({ etd: '2026-08-06', eta: '2026-08-12' });
  });

  it('falls back to legacy combined etdEta', () => {
    expect(
      resolveArrivalNoticeSchedule({
        etdEta: 'ETD 14 Aug 2026 / ETA 22 Aug 2026',
      }),
    ).toEqual({ etd: '14 Aug 2026', eta: '22 Aug 2026' });
  });

  it('strips prefixes on single schedule dates', () => {
    expect(formatScheduleDateForPdf('ETD 2026-08-06')).toBe('2026-08-06');
    expect(formatScheduleDateForPdf('ETA: 2026-08-12')).toBe('2026-08-12');
  });
});
