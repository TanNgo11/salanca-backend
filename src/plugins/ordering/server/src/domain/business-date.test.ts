import { describe, expect, it } from 'vitest';
import { businessDate, calendarDate } from './business-date';

describe('businessDate across local midnight', () => {
  it.each([
    ['2026-10-09T16:40:00Z', '2026-10-09'], // Friday 23:40 in Vietnam
    ['2026-10-09T18:30:00Z', '2026-10-09'], // Saturday 01:30 in Vietnam
    ['2026-10-09T20:59:59Z', '2026-10-09'],
    ['2026-10-09T21:00:00Z', '2026-10-10'], // exact 04:00 cutoff
    ['2026-10-10T15:00:00Z', '2026-10-10'], // opening 22:00
    ['2026-10-10T19:00:00Z', '2026-10-10'], // next day's 02:00
    ['2026-12-31T18:30:00Z', '2026-12-31'],
    ['2024-02-29T18:30:00Z', '2024-02-29'],
  ])('%s belongs to %s', (instant, expected) => {
    expect(businessDate(new Date(instant), 'Asia/Ho_Chi_Minh')).toBe(expected);
  });
  it('handles a different branch timezone', () => {
    expect(businessDate(new Date('2026-10-10T01:00:00Z'), 'UTC')).toBe('2026-10-09');
  });
  it('rejects invalid dates, timezones and cutoff values', () => {
    expect(() => businessDate(new Date('invalid'), 'UTC')).toThrow();
    expect(() => businessDate(new Date(), 'invalid/timezone')).toThrow();
    expect(() => businessDate(new Date(), 'UTC', '25:00')).toThrow();
  });
});

describe('calendarDate', () => {
  it.each([
    ['2026-10-16T16:59:59Z', '2026-10-16'], // 23:59:59 in Vietnam
    ['2026-10-16T17:00:00Z', '2026-10-17'], // 00:00 in Vietnam: the UTC date is still the 16th
    ['2026-10-16T18:30:00Z', '2026-10-17'],
    ['2026-10-17T02:00:00Z', '2026-10-17'],
  ])('%s is %s in Ho Chi Minh', (instant, expected) => {
    expect(calendarDate(new Date(instant), 'Asia/Ho_Chi_Minh')).toBe(expected);
  });
  it('does not apply the 04:00 business-day cutoff', () => {
    expect(calendarDate(new Date('2026-10-16T18:30:00Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-10-17');
    expect(businessDate(new Date('2026-10-16T18:30:00Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-10-16');
  });
});
