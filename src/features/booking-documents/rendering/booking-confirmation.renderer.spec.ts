import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { formatPdfDateTime } from './pdf-schedule-date';
import {
  BOOKING_CONFIRMATION_TERMS,
  bookingConfirmationToLineLayout,
  buildSiVgmCutoffBlocks,
  formatBookingConfirmationTermsBody,
  measureBookingConfirmationTermsHeight,
} from './booking-confirmation.renderer';
import { DOC_SECTION_LABEL_SIZE } from './pdf-layout';

describe('booking confirmation To line baseline', () => {
  it('aligns label drawText y with drawTextBlock first-line baseline', () => {
    const toTop = 640;
    const layout = bookingConfirmationToLineLayout(toTop);
    expect(layout.size).toBe(DOC_SECTION_LABEL_SIZE);
    expect(layout.blockTop).toBe(toTop);
    // drawTextBlock first line: y = top - size
    expect(layout.blockTop - layout.size).toBe(layout.baselineY);
  });

  it('keeps a shared baseline when DejaVu and Arial ascents differ', async () => {
    const fontsDir = join(__dirname, '..', 'assets', 'fonts');
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const heading = await pdf.embedFont(
      readFileSync(join(fontsDir, 'DejaVuSans-Bold.ttf')),
    );
    const bold = await pdf.embedFont(
      readFileSync(join(fontsDir, 'Arial-Bold.ttf')),
    );
    const size = DOC_SECTION_LABEL_SIZE;
    const labelAscent = heading.heightAtSize(size, { descender: false });
    const valueAscent = bold.heightAtSize(size, { descender: false });
    // Fonts differ optically, but layout still uses one PDF baseline (not per-font tops).
    expect(Math.abs(labelAscent - valueAscent)).toBeGreaterThan(0.01);

    const layout = bookingConfirmationToLineLayout(600, size);
    expect(layout.baselineY).toBe(layout.blockTop - size);
  });
});

describe('booking confirmation schedule fields', () => {
  it('formats ETD/ETA for PDF display', () => {
    expect(formatPdfDateTime('14/06/2026')).toBe('Jun 14, 2026');
    expect(formatPdfDateTime('2026-08-07T17:00:00')).toBe(
      'Aug 07, 2026 17:00:00',
    );
  });

  it('treats blank schedule values as hidden', () => {
    expect(formatPdfDateTime('')).toBe('');
    expect(formatPdfDateTime(null)).toBe('');
    expect(formatPdfDateTime(undefined)).toBe('');
  });
});

describe('booking confirmation SI/VGM stacked cutoff', () => {
  it('stacks SI and VGM with formatted datetime values', () => {
    expect(
      buildSiVgmCutoffBlocks('30/06/2026 08:00:00', '2026-06-30T10:00:00'),
    ).toEqual([
      { label: 'SI Cut off', value: 'Jun 30, 2026 08:00:00' },
      { label: 'VGM Cut off', value: 'Jun 30, 2026 10:00:00' },
    ]);
  });

  it('omits empty sides and hides the cell when both blank', () => {
    expect(buildSiVgmCutoffBlocks('30/06/2026 08:00', undefined)).toEqual([
      { label: 'SI Cut off', value: 'Jun 30, 2026 08:00:00' },
    ]);
    expect(buildSiVgmCutoffBlocks('', '  ')).toEqual([]);
  });
});

describe('booking confirmation terms and conditions', () => {
  it('includes the six reference terms in order', () => {
    expect(BOOKING_CONFIRMATION_TERMS).toHaveLength(6);
    expect(BOOKING_CONFIRMATION_TERMS[0]).toContain(
      'picking-up the empty container out of the C/Y',
    );
    expect(BOOKING_CONFIRMATION_TERMS[1]).toContain(
      "carrier's space and equipment availability",
    );
    expect(BOOKING_CONFIRMATION_TERMS[2]).toContain(
      'changed without prior notice',
    );
    expect(BOOKING_CONFIRMATION_TERMS[3]).toContain('swapping fee');
    expect(BOOKING_CONFIRMATION_TERMS[4]).toContain('gating out');
    expect(BOOKING_CONFIRMATION_TERMS[5]).toContain('wrong weight declaration');
  });

  it('formats a numbered left-aligned body block', () => {
    const body = formatBookingConfirmationTermsBody();
    expect(body.startsWith('1. The booking information')).toBe(true);
    expect(body).toContain(
      '6. Any damage/expenses happen due to client/shipper',
    );
    expect(body.split('\n')).toHaveLength(6);
  });

  it('measures a positive height for the terms block', async () => {
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const height = measureBookingConfirmationTermsHeight(regular, 500);
    expect(height).toBeGreaterThan(80);
  });
});
