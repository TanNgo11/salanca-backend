import { describe, expect, it } from 'vitest';

import { buildReservationConfirmationEmail } from './reservation-confirmation-email';

const base = {
  fullName: 'Nguyễn Văn An',
  phone: '0901234567',
  preferredDate: '2030-06-15',
  preferredTime: '19:00',
  guestCount: 4,
  restaurant: {
    brandName: 'Salanca Brazil',
    hotline: '0989 561 159',
    address: '49 Phan Bội Châu, Cửa Nam, Hà Nội',
  },
};

describe('reservation confirmation email', () => {
  it('writes Vietnamese for VI requests and says the table is not yet confirmed', () => {
    const email = buildReservationConfirmationEmail({ ...base, locale: 'vi' });
    expect(email.subject).toBe('Salanca Brazil đã nhận yêu cầu đặt bàn của bạn');
    expect(email.text).toContain('15/06/2030 lúc 19:00');
    expect(email.text).toContain('4 khách');
    expect(email.text).toContain('chưa phải xác nhận giữ bàn');
    expect(email.text).toContain('0901234567');
    expect(email.text).toContain('0989 561 159');
    expect(email.html).toContain('Nguyễn Văn An');
  });

  it('writes English for EN requests', () => {
    const email = buildReservationConfirmationEmail({ ...base, locale: 'en', guestCount: 1 });
    expect(email.subject).toBe('Salanca Brazil received your reservation request');
    expect(email.text).toContain('15/06/2030 at 19:00');
    expect(email.text).toContain('1 guest');
    expect(email.text).not.toContain('1 guests');
    expect(email.text).toContain('not yet a confirmed booking');
  });

  it('omits the hotline and address lines when the CMS has none', () => {
    const email = buildReservationConfirmationEmail({
      ...base,
      locale: 'vi',
      restaurant: { brandName: 'Salanca Brazil' },
    });
    expect(email.text).not.toContain('Hotline');
    expect(email.text).not.toContain('Địa chỉ');
  });

  it('escapes HTML in the guest name', () => {
    const email = buildReservationConfirmationEmail({
      ...base,
      locale: 'vi',
      fullName: '<script>x</script>',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});
