import { PDFDocument, StandardFonts } from 'pdf-lib';
import { formatBookingPdfDateTime } from './pdf-schedule-date';
import {
  BOOKING_CONFIRMATION_TERMS,
  formatBookingConfirmationTermsBody,
  measureBookingConfirmationTermsHeight,
} from './booking-confirmation.renderer';

describe('booking confirmation schedule fields', () => {
  it('formats ETD/ETA for PDF display', () => {
    expect(formatBookingPdfDateTime('14/06/2026')).toBe('14 Jun 2026');
    expect(formatBookingPdfDateTime('2026-08-07T17:00:00')).toBe(
      '07 Aug 2026 17:00',
    );
  });

  it('treats blank schedule values as hidden', () => {
    expect(formatBookingPdfDateTime('')).toBe('');
    expect(formatBookingPdfDateTime(null as unknown as string)).toBe('');
    expect(formatBookingPdfDateTime(undefined)).toBe('');
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
