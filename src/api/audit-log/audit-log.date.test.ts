import { describe, expect, it } from 'vitest';

import {
  AUDIT_LOG_DEFAULT_DAY_COUNT,
  addVietnamCalendarDays,
  calendarDaysBetween,
  defaultAuditLogDateRange,
  readVietnamCalendarDate,
  vietnamLocalMidnightUtc,
} from './audit-log.date';

describe('Vietnam audit date window', () => {
  it('resolves local midnight without adding seven hours by hand', () => {
    const midnight = vietnamLocalMidnightUtc(2026, 8, 27);
    const local = readVietnamCalendarDate(midnight);
    expect(local).toEqual({ year: 2026, month: 8, day: 27 });
    expect(midnight.toISOString().endsWith('T17:00:00.000Z')).toBe(true);
  });

  it('uses a half-open default covering 30 Vietnam calendar days', () => {
    const now = new Date('2026-08-27T10:00:00.000+07:00');
    const range = defaultAuditLogDateRange(now);
    const from = new Date(range.from);
    const toExclusive = new Date(range.toExclusive);

    expect(readVietnamCalendarDate(from)).toEqual({ year: 2026, month: 7, day: 29 });
    expect(readVietnamCalendarDate(toExclusive)).toEqual({
      year: 2026,
      month: 8,
      day: 28,
    });
    expect(calendarDaysBetween(from, toExclusive)).toBe(AUDIT_LOG_DEFAULT_DAY_COUNT);
    expect(from.getTime()).toBeLessThan(toExclusive.getTime());
  });

  it('advances calendar dates across month boundaries', () => {
    expect(addVietnamCalendarDays({ year: 2026, month: 8, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 9,
      day: 1,
    });
  });
});
