import { formatBookingPic, resolveBookingPic } from './booking-pic';

describe('booking pic formatting', () => {
  it('formats full name and email together', () => {
    expect(
      formatBookingPic('Nhung Nguyen', 'total.logistics@seatrans.com.vn'),
    ).toBe('Nhung Nguyen, Email: total.logistics@seatrans.com.vn');
  });

  it('falls back to name or email when one is missing', () => {
    expect(formatBookingPic('Nhung Nguyen', null)).toBe('Nhung Nguyen');
    expect(formatBookingPic('', 'ops@seatrans.com.vn')).toBe('ops@seatrans.com.vn');
  });

  it('prefers creator info and keeps legacy pic when creator is missing', () => {
    expect(
      resolveBookingPic(
        { fullName: 'Nhung Nguyen', email: 'total.logistics@seatrans.com.vn' },
        'Legacy PIC',
      ),
    ).toBe('Nhung Nguyen, Email: total.logistics@seatrans.com.vn');
    expect(resolveBookingPic(null, 'Legacy PIC')).toBe('Legacy PIC');
    expect(resolveBookingPic(null, '')).toBe('');
  });
});
