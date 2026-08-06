import { describe, expect, it } from 'vitest';

import {
  isValidCalendarDate,
  parseReservationRequestInput,
  ReservationRequestValidationError,
  ReservationRequestValidationErrorCode,
  todayInHoChiMinh,
} from './reservation-request.validation';

const TODAY = '2026-08-05';

const base = {
  fullName: 'Nguyen Van A',
  phone: '0901234567',
  preferredDate: '2026-08-20',
  preferredTime: '19:00',
  guestCount: 4,
  menuSelectionMode: 'later',
  sourceLocale: 'vi',
} as const;

const parse = (raw: unknown) => parseReservationRequestInput(raw, { today: TODAY });

describe('isValidCalendarDate', () => {
  it('accepts real dates', () => {
    expect(isValidCalendarDate('2026-08-05')).toBe(true);
    expect(isValidCalendarDate('2024-02-29')).toBe(true);
  });

  it('rejects invalid calendars', () => {
    expect(isValidCalendarDate('2026-02-31')).toBe(false);
    expect(isValidCalendarDate('2026-13-01')).toBe(false);
    expect(isValidCalendarDate('26-08-05')).toBe(false);
  });
});

describe('todayInHoChiMinh', () => {
  it('returns YYYY-MM-DD', () => {
    expect(todayInHoChiMinh(new Date('2026-08-05T12:00:00+07:00'))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });
});

describe('preferredTime format', () => {
  /*
   * Soft-overlap counting matches on exact string equality, so a free-text
   * time would split one real slot across "19:00" / "7:00 PM" / "19h" and
   * make overlapCount silently under-report.
   */
  it('accepts canonical 24-hour HH:mm', () => {
    for (const preferredTime of ['00:00', '09:05', '19:00', '23:59']) {
      expect(parse({ ...base, preferredTime }).preferredTime).toBe(preferredTime);
    }
  });

  it('rejects any other spelling of a time', () => {
    for (const preferredTime of ['7:00 PM', '19h', '24:00', '19:60', '19.00', '1900']) {
      expect(() => parse({ ...base, preferredTime })).toThrow(
        ReservationRequestValidationError,
      );
    }
  });

  it('reports the dedicated invalid-format code', () => {
    try {
      parse({ ...base, preferredTime: '7:00 PM' });
      expect.unreachable('expected a validation error');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        ReservationRequestValidationErrorCode.PreferredTimeInvalid,
      );
    }
  });
});

describe('parseReservationRequestInput', () => {
  it('accepts later mode and forces status new', () => {
    const result = parse({
      ...base,
      status: 'archived',
      website: '',
    });
    expect(result).toEqual({
      fullName: 'Nguyen Van A',
      phone: '0901234567',
      preferredDate: '2026-08-20',
      preferredTime: '19:00',
      guestCount: 4,
      menuSelectionMode: 'later',
      menuPackageIds: [],
      menuItemIds: [],
      sourceLocale: 'vi',
      status: 'new',
    });
  });

  it('accepts now mode with packages and items', () => {
    const result = parse({
      ...base,
      menuSelectionMode: 'now',
      menuPackages: [' pkg1 ', 'pkg1', 'pkg2'],
      menuItems: ['item1'],
      email: ' a@example.com ',
      occasion: 'birthday',
      note: 'Window seat',
      sourcePath: '/vi/dat-ban',
    });
    expect(result.menuSelectionMode).toBe('now');
    expect(result.menuPackageIds).toEqual(['pkg1', 'pkg2']);
    expect(result.menuItemIds).toEqual(['item1']);
    expect(result.email).toBe('a@example.com');
    expect(result.occasion).toBe('birthday');
    expect(result.note).toBe('Window seat');
    expect(result.sourcePath).toBe('/vi/dat-ban');
  });

  it('accepts guestCount as numeric string', () => {
    const result = parse({ ...base, guestCount: '8' });
    expect(result.guestCount).toBe(8);
  });

  it('accepts locale alias', () => {
    const result = parse({
      fullName: 'A',
      phone: '0901',
      preferredDate: '2026-08-20',
      preferredTime: '18:00',
      guestCount: 2,
      menuSelectionMode: 'later',
      locale: 'en',
    });
    expect(result.sourceLocale).toBe('en');
  });

  it('rejects non-object body', () => {
    try {
      parse(null);
      expect.unreachable('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ReservationRequestValidationError);
      expect((error as ReservationRequestValidationError).code).toBe(
        ReservationRequestValidationErrorCode.InvalidBody,
      );
    }
  });

  it('rejects honeypot', () => {
    try {
      parse({ ...base, website: 'http://spam' });
      expect.unreachable('should throw');
    } catch (error) {
      expect((error as ReservationRequestValidationError).code).toBe(
        ReservationRequestValidationErrorCode.Honeypot,
      );
    }
  });

  it('rejects missing phone', () => {
    try {
      parse({ ...base, phone: '  ' });
      expect.unreachable('should throw');
    } catch (error) {
      expect((error as ReservationRequestValidationError).code).toBe(
        ReservationRequestValidationErrorCode.PhoneRequired,
      );
    }
  });

  it('rejects past preferredDate', () => {
    try {
      parse({ ...base, preferredDate: '2026-08-01' });
      expect.unreachable('should throw');
    } catch (error) {
      expect((error as ReservationRequestValidationError).code).toBe(
        ReservationRequestValidationErrorCode.PreferredDatePast,
      );
    }
  });

  it('accepts today as preferredDate', () => {
    const result = parse({ ...base, preferredDate: TODAY });
    expect(result.preferredDate).toBe(TODAY);
  });

  it('rejects invalid date', () => {
    try {
      parse({ ...base, preferredDate: '2026-02-31' });
      expect.unreachable('should throw');
    } catch (error) {
      expect((error as ReservationRequestValidationError).code).toBe(
        ReservationRequestValidationErrorCode.PreferredDateInvalid,
      );
    }
  });

  it('rejects later mode with menu ids', () => {
    try {
      parse({ ...base, menuSelectionMode: 'later', menuPackages: ['p1'] });
      expect.unreachable('should throw');
    } catch (error) {
      expect((error as ReservationRequestValidationError).code).toBe(
        ReservationRequestValidationErrorCode.MenuNotAllowed,
      );
    }
  });

  it('rejects now mode without menu', () => {
    try {
      parse({ ...base, menuSelectionMode: 'now' });
      expect.unreachable('should throw');
    } catch (error) {
      expect((error as ReservationRequestValidationError).code).toBe(
        ReservationRequestValidationErrorCode.MenuRequired,
      );
    }
  });

  it('rejects guestCount out of range', () => {
    try {
      parse({ ...base, guestCount: 0 });
      expect.unreachable('should throw');
    } catch (error) {
      expect((error as ReservationRequestValidationError).code).toBe(
        ReservationRequestValidationErrorCode.GuestCountInvalid,
      );
    }
  });

  it('rejects invalid email', () => {
    try {
      parse({ ...base, email: 'not-an-email' });
      expect.unreachable('should throw');
    } catch (error) {
      expect((error as ReservationRequestValidationError).code).toBe(
        ReservationRequestValidationErrorCode.EmailInvalid,
      );
    }
  });

  it('rejects too many packages', () => {
    try {
      parse({
        ...base,
        menuSelectionMode: 'now',
        menuPackages: ['a', 'b', 'c', 'd', 'e', 'f'],
      });
      expect.unreachable('should throw');
    } catch (error) {
      expect((error as ReservationRequestValidationError).code).toBe(
        ReservationRequestValidationErrorCode.MenuTooMany,
      );
    }
  });
});
