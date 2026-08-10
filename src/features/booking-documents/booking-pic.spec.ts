import { formatBookingPic, resolveBookingPic } from './booking-pic';

describe('booking pic formatting', () => {
  it('formats full name and email together', () => {
    expect(
      formatBookingPic('Nhung Nguyen', 'total.logistics@seatrans.com.vn'),
    ).toBe('Nhung Nguyen, Email: total.logistics@seatrans.com.vn');
  });

  it('falls back to name or email when one is missing', () => {
    expect(formatBookingPic('Nhung Nguyen', null)).toBe('Nhung Nguyen');
    expect(formatBookingPic('', 'ops@seatrans.com.vn')).toBe(
      'ops@seatrans.com.vn',
    );
  });

  it('prefers selected pic over creator, then falls back to creator', () => {
    expect(
      resolveBookingPic(
        { fullName: 'Creator', email: 'creator@seatrans.com.vn' },
        'Selected User, Email: selected@seatrans.com.vn',
      ),
    ).toBe('Selected User, Email: selected@seatrans.com.vn');
    expect(
      resolveBookingPic(
        { fullName: 'Nhung Nguyen', email: 'total.logistics@seatrans.com.vn' },
        '',
      ),
    ).toBe('Nhung Nguyen, Email: total.logistics@seatrans.com.vn');
    expect(resolveBookingPic(null, 'Legacy PIC')).toBe('Legacy PIC');
    expect(resolveBookingPic(null, '')).toBe('');
  });

  it('prefers company email over login email for creator fallback', () => {
    expect(
      resolveBookingPic(
        {
          fullName: 'Nhung Nguyen',
          email: 'login@seatrans.com.vn',
          companyEmail: 'total.logistics@seatrans.com.vn',
        },
        '',
      ),
    ).toBe('Nhung Nguyen, Email: total.logistics@seatrans.com.vn');
  });
});
