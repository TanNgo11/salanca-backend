import type { PickupSettings, TimeRange } from '../branch-settings';
import { WEEKDAYS } from '../branch-settings';
import { addDays, localToUtc, minutesOf, toLocalParts, weekdayOf } from './zoned-time';

/**
 * Pickup slot generation (contracts §9, §19.5; TastyIgniter `WorkingRange` semantics). Pure: the
 * caller passes `now`, the effective lead time (max of branch and lines) and the booked count per
 * slot start. A range with `end <= start` closes after midnight and belongs to the local date it
 * opens on. Slots never cross the end of their range.
 */
export type Slot = {
  startsAt: string;
  endsAt: string;
  localDate: string;
  localStart: string;
  capacity: number;
  booked: number;
  remaining: number;
  available: boolean;
  reason?: 'too-early' | 'full';
};

export type SlotInput = {
  settings: PickupSettings;
  timezone: string;
  now: Date;
  date: string;
  leadTimeMinutes: number;
  booked?: Record<string, number>;
};

const DAY_MINUTES = 24 * 60;

export type DayKind = 'special' | 'holiday' | 'regular';

/**
 * Why a date has the hours it has. A special-hours row wins even when that row is closed,
 * then a holiday, then the regular opening hours.
 */
export function dayKind(settings: PickupSettings, date: string): DayKind {
  const policy = settings.schedule.businessDayPolicy;
  if (policy.specialHours.some((row) => row.date === date)) return 'special';
  if (policy.holidayDates.includes(date)) return 'holiday';
  return 'regular';
}

const toAbsolute = (ranges: TimeRange[]): Array<{ from: number; to: number }> =>
  ranges.map((range) => {
    const from = minutesOf(range.start);
    const end = minutesOf(range.end);
    return { from, to: end <= from ? end + DAY_MINUTES : end };
  });

/**
 * Opening ranges of a local date as absolute minutes from that date's midnight.
 * Priority for the date: `specialHours` (including a closed day), then `holidayDates`,
 * then `openingHours`.
 */
export function rangesForDate(settings: PickupSettings, date: string): Array<{ from: number; to: number }> {
  const schedule = settings.schedule;
  const special = schedule.businessDayPolicy.specialHours.find((row) => row.date === date);
  if (special) return special.closed ? [] : toAbsolute(special.ranges);
  if (schedule.businessDayPolicy.holidayDates.includes(date)) return [];
  const hours = schedule.openingHours;
  if (hours.mode === '24_7') return [{ from: 0, to: DAY_MINUTES }];
  const ranges: TimeRange[] =
    hours.mode === 'weekly' ? hours.weekly[WEEKDAYS[weekdayOf(date)]] ?? [] : hours.daily;
  return toAbsolute(ranges);
}

/** Earliest allowed slot start: now + lead time. */
export const earliestStart = (now: Date, leadTimeMinutes: number): Date =>
  new Date(now.getTime() + leadTimeMinutes * 60_000);

/** Today in the branch, and the last date customers may book. */
export function bookingWindow(settings: PickupSettings, timezone: string, now: Date) {
  const today = toLocalParts(now, timezone).date;
  return { today, lastDate: addDays(today, settings.schedule.maxAdvanceDays) };
}

export function listSlots(input: SlotInput): Slot[] {
  const { settings, timezone, now, date } = input;
  const { today, lastDate } = bookingWindow(settings, timezone, now);
  // Yesterday stays listable: its past-midnight tail (22:00–02:00) can still be ahead of now.
  if (date < addDays(today, -1) || date > lastDate) return [];
  const length = settings.schedule.slotLengthMinutes;
  const capacity = settings.schedule.capacity;
  const earliest = earliestStart(now, input.leadTimeMinutes).getTime();
  const midnight = localToUtc(date, '00:00', timezone).getTime();
  const slots: Slot[] = [];
  const seen = new Set<string>();
  for (const range of rangesForDate(settings, date)) {
    for (let start = range.from; start + length <= range.to; start += length) {
      const startsAt = new Date(midnight + start * 60_000);
      const key = startsAt.toISOString();
      if (seen.has(key)) continue;
      seen.add(key);
      const booked = input.booked?.[key] ?? 0;
      const tooEarly = startsAt.getTime() < earliest;
      const full = booked >= capacity;
      slots.push({
        startsAt: key,
        endsAt: new Date(startsAt.getTime() + length * 60_000).toISOString(),
        localDate: date,
        localStart: toLocalParts(startsAt, timezone).time,
        capacity,
        booked,
        remaining: Math.max(0, capacity - booked),
        available: !tooEarly && !full,
        ...(tooEarly ? { reason: 'too-early' as const } : full ? { reason: 'full' as const } : {}),
      });
    }
  }
  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export type SlotCheck =
  | { ok: true; slot: Slot }
  | { ok: false; code: 'SLOT_TOO_EARLY' | 'SLOT_UNAVAILABLE' | 'SLOT_FULL'; earliest?: string };

/**
 * Validates a requested slot start. The local date is derived from the instant itself, and the
 * previous date is also checked so a past-midnight slot (01:30 of a 22:00–02:00 range) matches.
 */
export function checkSlot(input: Omit<SlotInput, 'date'> & { startsAt: string }): SlotCheck {
  const requested = new Date(input.startsAt);
  if (!Number.isFinite(requested.getTime())) return { ok: false, code: 'SLOT_UNAVAILABLE' };
  const key = requested.toISOString();
  const earliest = earliestStart(input.now, input.leadTimeMinutes);
  const localDate = toLocalParts(requested, input.timezone).date;
  for (const date of [localDate, addDays(localDate, -1)]) {
    const slot = listSlots({ ...input, date }).find((candidate) => candidate.startsAt === key);
    if (!slot) continue;
    if (slot.reason === 'too-early') {
      return { ok: false, code: 'SLOT_TOO_EARLY', earliest: earliest.toISOString() };
    }
    if (slot.reason === 'full') return { ok: false, code: 'SLOT_FULL' };
    return { ok: true, slot };
  }
  if (requested.getTime() < earliest.getTime()) {
    return { ok: false, code: 'SLOT_TOO_EARLY', earliest: earliest.toISOString() };
  }
  return { ok: false, code: 'SLOT_UNAVAILABLE' };
}

/** True while `now` falls inside an opening range (today's, or yesterday's past-midnight tail). */
export function isOpenAt(settings: PickupSettings, timezone: string, now: Date): boolean {
  const today = toLocalParts(now, timezone).date;
  for (const date of [today, addDays(today, -1)]) {
    const midnight = localToUtc(date, '00:00', timezone).getTime();
    for (const range of rangesForDate(settings, date)) {
      const from = midnight + range.from * 60_000;
      const to = midnight + range.to * 60_000;
      if (now.getTime() >= from && now.getTime() < to) return true;
    }
  }
  return false;
}

/**
 * ASAP needs the branch open now and ready time (now + lead) before the current range closes.
 * Returns the estimated ready instant, or null when ASAP is not possible.
 */
export function asapReadyAt(
  settings: PickupSettings,
  timezone: string,
  now: Date,
  leadTimeMinutes: number,
): Date | null {
  if (settings.orderTiming === 'scheduled') return null;
  const ready = earliestStart(now, leadTimeMinutes);
  const today = toLocalParts(now, timezone).date;
  // Ranges from yesterday to tomorrow as instants. A range that ends where the next begins
  // (24/7, or 18:00–24:00 then 00:00–02:00) is one opening: ASAP ordered just before midnight
  // must not fail because its ready time falls on the next calendar day.
  const ranges = [addDays(today, -1), today, addDays(today, 1)]
    .flatMap((date) => {
      const midnight = localToUtc(date, '00:00', timezone).getTime();
      return rangesForDate(settings, date).map((range) => ({
        from: midnight + range.from * 60_000,
        to: midnight + range.to * 60_000,
      }));
    })
    .sort((a, b) => a.from - b.from);
  const current = ranges.find((range) => now.getTime() >= range.from && now.getTime() < range.to);
  if (!current) return null;
  let closesAt = current.to;
  for (const range of ranges) {
    if (range.from <= closesAt && range.to > closesAt) closesAt = range.to;
  }
  return ready.getTime() <= closesAt ? ready : null;
}

/** Hold resource key for a pickup slot; one advisory lock per key serializes the last seat. */
export const slotResourceRef = (locationRef: string, startsAt: string): string =>
  `slot:${locationRef}:pickup:${new Date(startsAt).toISOString()}`;
