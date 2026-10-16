import { describe, expect, it } from 'vitest';

import { notificationDay, notificationDayStart } from './budget-day';

describe('notification budget day', () => {
  describe('Asia/Ho_Chi_Minh', () => {
    it('rolls the calendar day over at 17:00Z (local midnight)', () => {
      expect(notificationDay(new Date('2026-10-15T16:59:59Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-10-15');
      expect(notificationDay(new Date('2026-10-15T17:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-10-16');
    });

    it('starts the local day at 17:00Z of the previous UTC date', () => {
      expect(
        notificationDayStart(new Date('2026-10-15T20:00:00Z'), 'Asia/Ho_Chi_Minh').toISOString(),
      ).toBe('2026-10-15T17:00:00.000Z');
    });
  });

  describe('UTC', () => {
    it('matches the UTC calendar day and starts at 00:00Z', () => {
      expect(notificationDay(new Date('2026-10-15T23:30:00Z'), 'UTC')).toBe('2026-10-15');
      expect(notificationDay(new Date('2026-10-16T00:30:00Z'), 'UTC')).toBe('2026-10-16');
      expect(notificationDayStart(new Date('2026-10-15T23:30:00Z'), 'UTC').toISOString()).toBe(
        '2026-10-15T00:00:00.000Z',
      );
    });
  });

  describe('America/New_York around DST', () => {
    it('starts the spring-forward day at 05:00Z (EST, -5h)', () => {
      expect(
        notificationDayStart(new Date('2026-03-08T12:00:00Z'), 'America/New_York').toISOString(),
      ).toBe('2026-03-08T05:00:00.000Z');
    });

    it('starts the fall-back day at 04:00Z (EDT, -4h)', () => {
      expect(
        notificationDayStart(new Date('2026-11-01T12:00:00Z'), 'America/New_York').toISOString(),
      ).toBe('2026-11-01T04:00:00.000Z');
    });
  });

  it('throws on an unknown timezone', () => {
    expect(() => notificationDay(new Date('2026-10-15T00:00:00Z'), 'Not/AZone')).toThrow();
    expect(() => notificationDayStart(new Date('2026-10-15T00:00:00Z'), 'Not/AZone')).toThrow();
  });
});
