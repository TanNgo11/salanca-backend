import { describe, expect, it } from 'vitest';

import { resolvePickupSettings } from '../branch-settings';
import { asapReadyAt, checkSlot, isOpenAt, listSlots } from './slots';
import { localToUtc, toLocalParts } from './zoned-time';

const TZ = 'Asia/Ho_Chi_Minh';
const settings = (overrides: Record<string, unknown> = {}, schedule: Record<string, unknown> = {}) =>
  resolvePickupSettings({
    enabled: true,
    ...overrides,
    schedule: { slotLengthMinutes: 30, capacity: 2, ...schedule },
  });

describe('zoned time', () => {
  it('converts branch-local wall time to UTC and back', () => {
    const instant = localToUtc('2026-10-12', '09:30', TZ);
    expect(instant.toISOString()).toBe('2026-10-12T02:30:00.000Z');
    expect(toLocalParts(instant, TZ)).toEqual({ date: '2026-10-12', time: '09:30', weekday: 0 });
  });
});

describe('listSlots', () => {
  const now = localToUtc('2026-10-12', '08:00', TZ);

  it('starts at now + lead time (180) and keeps slots inside the range', () => {
    const slots = listSlots({
      settings: settings({}, { openingHours: { mode: 'daily', daily: [{ start: '07:00', end: '13:00' }] } }),
      timezone: TZ,
      now,
      date: '2026-10-12',
      leadTimeMinutes: 180,
    });
    const available = slots.filter((slot) => slot.available).map((slot) => slot.localStart);
    expect(available).toEqual(['11:00', '11:30', '12:00', '12:30']);
    expect(slots.find((slot) => slot.localStart === '10:30')?.reason).toBe('too-early');
    expect(slots.at(-1)?.endsAt).toBe(localToUtc('2026-10-12', '13:00', TZ).toISOString());
  });

  it('extends a 22:00–02:00 range past midnight onto the opening date', () => {
    const slots = listSlots({
      settings: settings({}, { openingHours: { mode: 'daily', daily: [{ start: '22:00', end: '02:00' }] } }),
      timezone: TZ,
      now,
      date: '2026-10-12',
      leadTimeMinutes: 0,
    });
    expect(slots.map((slot) => slot.localStart)).toEqual([
      '22:00', '22:30', '23:00', '23:30', '00:00', '00:30', '01:00', '01:30',
    ]);
    expect(slots.at(-1)?.startsAt).toBe(localToUtc('2026-10-13', '01:30', TZ).toISOString());
  });

  it('marks full slots and returns nothing on holidays or beyond max advance days', () => {
    const base = settings({}, {
      openingHours: { mode: 'daily', daily: [{ start: '12:00', end: '13:00' }] },
      maxAdvanceDays: 2,
      businessDayPolicy: { holidayDates: ['2026-10-13'] },
    });
    const noon = localToUtc('2026-10-12', '12:00', TZ).toISOString();
    const today = listSlots({ settings: base, timezone: TZ, now, date: '2026-10-12', leadTimeMinutes: 0, booked: { [noon]: 2 } });
    expect(today[0]).toMatchObject({ available: false, reason: 'full', remaining: 0 });
    expect(listSlots({ settings: base, timezone: TZ, now, date: '2026-10-13', leadTimeMinutes: 0 })).toEqual([]);
    expect(listSlots({ settings: base, timezone: TZ, now, date: '2026-10-14', leadTimeMinutes: 0 })).toHaveLength(2);
    expect(listSlots({ settings: base, timezone: TZ, now, date: '2026-10-15', leadTimeMinutes: 0 })).toEqual([]);
  });

  it('uses the weekday table in weekly mode', () => {
    const weekly = settings({}, {
      openingHours: { mode: 'weekly', weekly: { mon: [{ start: '10:00', end: '11:00' }] } },
    });
    expect(listSlots({ settings: weekly, timezone: TZ, now, date: '2026-10-12', leadTimeMinutes: 0 })).toHaveLength(2);
    expect(listSlots({ settings: weekly, timezone: TZ, now, date: '2026-10-13', leadTimeMinutes: 0 })).toEqual([]);
  });
});

describe('checkSlot', () => {
  const daily = settings({}, { openingHours: { mode: 'daily', daily: [{ start: '07:00', end: '22:00' }] } });
  const now = localToUtc('2026-10-12', '08:00', TZ);

  it('rejects starts earlier than now + lead time with the earliest instant', () => {
    const result = checkSlot({
      settings: daily, timezone: TZ, now, leadTimeMinutes: 180,
      startsAt: localToUtc('2026-10-12', '10:30', TZ).toISOString(),
    });
    expect(result).toEqual({
      ok: false,
      code: 'SLOT_TOO_EARLY',
      earliest: localToUtc('2026-10-12', '11:00', TZ).toISOString(),
    });
  });

  it('rejects misaligned or closed starts and accepts a real slot', () => {
    const misaligned = checkSlot({
      settings: daily, timezone: TZ, now, leadTimeMinutes: 0,
      startsAt: localToUtc('2026-10-12', '12:10', TZ).toISOString(),
    });
    expect(misaligned).toEqual({ ok: false, code: 'SLOT_UNAVAILABLE' });
    const ok = checkSlot({
      settings: daily, timezone: TZ, now, leadTimeMinutes: 0,
      startsAt: localToUtc('2026-10-12', '12:30', TZ).toISOString(),
    });
    expect(ok.ok).toBe(true);
  });

  it('accepts the past-midnight tail of yesterday range', () => {
    const late = settings({}, { openingHours: { mode: 'daily', daily: [{ start: '22:00', end: '02:00' }] } });
    const result = checkSlot({
      settings: late, timezone: TZ, now: localToUtc('2026-10-13', '00:10', TZ), leadTimeMinutes: 30,
      startsAt: localToUtc('2026-10-13', '01:00', TZ).toISOString(),
    });
    expect(result.ok).toBe(true);
  });
});

describe('ASAP', () => {
  const daily = settings({}, { openingHours: { mode: 'daily', daily: [{ start: '07:00', end: '22:00' }] } });

  it('needs the branch open and ready time before closing', () => {
    expect(isOpenAt(daily, TZ, localToUtc('2026-10-12', '06:59', TZ))).toBe(false);
    expect(asapReadyAt(daily, TZ, localToUtc('2026-10-12', '09:00', TZ), 60)?.toISOString()).toBe(
      localToUtc('2026-10-12', '10:00', TZ).toISOString(),
    );
    expect(asapReadyAt(daily, TZ, localToUtc('2026-10-12', '21:30', TZ), 60)).toBeNull();
    expect(
      asapReadyAt({ ...daily, orderTiming: 'scheduled' }, TZ, localToUtc('2026-10-12', '09:00', TZ), 0),
    ).toBeNull();
  });
});
