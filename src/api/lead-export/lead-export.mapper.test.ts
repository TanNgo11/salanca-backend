import { describe, expect, it } from 'vitest';

import {
  CONTACT_CSV_HEADERS,
  NEWSLETTER_CSV_HEADERS,
  RESERVATION_CSV_HEADERS,
  contactRow,
  newsletterRow,
  reservationRow,
  toVietnamDateTime,
} from './lead-export.mapper';

describe('lead export mapper', () => {
  it('formats timestamps in Vietnam time', () => {
    expect(toVietnamDateTime('2030-06-15T17:30:00.000Z')).toBe('16/06/2030 00:30');
    expect(toVietnamDateTime(null)).toBe('');
  });

  it('maps a reservation row in header order', () => {
    const row = reservationRow({
      createdAt: '2030-06-10T03:00:00.000Z',
      fullName: 'An',
      phone: '0901',
      email: null,
      preferredDate: '2030-06-15',
      preferredTime: '19:00',
      guestCount: 4,
      occasion: 'Sinh nhật',
      note: 'Bàn gần cửa sổ',
      menuPackages: [{ name: 'Buffet' }],
      menuItems: [],
      leadStatus: 'confirmed',
      staffNote: 'Đã gọi',
      overlapCount: 1,
      sourceLocale: 'vi',
    });
    expect(row).toHaveLength(RESERVATION_CSV_HEADERS.length);
    expect(row).toEqual([
      '10/06/2030 10:00',
      'An',
      '0901',
      '',
      '15/06/2030',
      '19:00',
      '4',
      'Sinh nhật',
      'Bàn gần cửa sổ',
      'Buffet',
      '',
      'Đã xác nhận',
      'Đã gọi',
      '1',
      'vi',
    ]);
  });

  it('treats a missing status as new', () => {
    expect(reservationRow({ leadStatus: null })[11]).toBe('Mới');
  });

  it('maps contact and newsletter rows', () => {
    expect(CONTACT_CSV_HEADERS).toHaveLength(9);
    expect(
      contactRow({
        createdAt: '2030-06-10T03:00:00.000Z',
        fullName: 'B',
        email: 'b@x.vn',
        phone: '',
        topic: 'event',
        message: 'Hi',
        leadStatus: 'read',
        sourceLocale: 'en',
        sourcePath: '/en/contact',
      }),
    ).toEqual(['10/06/2030 10:00', 'B', 'b@x.vn', '', 'event', 'Hi', 'Đã đọc', 'en', '/en/contact']);
    expect(NEWSLETTER_CSV_HEADERS).toEqual(['Đăng ký lúc', 'Email', 'Ngôn ngữ', 'Trang đăng ký']);
    expect(
      newsletterRow({
        createdAt: '2030-06-10T03:00:00.000Z',
        email: 'c@x.vn',
        sourceLocale: 'vi',
        sourcePath: '/vi',
      }),
    ).toEqual(['10/06/2030 10:00', 'c@x.vn', 'vi', '/vi']);
  });
});
