import { businessDate } from '../business-date';

/**
 * Calendar day (`YYYY-MM-DD`) of `now` in the notification timezone. Reuses the business-date
 * formatter with a `00:00` cutoff, which is exactly the plain local calendar date.
 */
export function notificationDay(now: Date, timezone: string): string {
  return businessDate(now, timezone, '00:00');
}

/** UTC instant of `00:00` of `notificationDay(now, timezone)` in that timezone. */
export function notificationDayStart(now: Date, timezone: string): Date {
  return notificationDayStartFor(notificationDay(now, timezone), timezone);
}

/**
 * UTC instant of `00:00` on a given `YYYY-MM-DD` calendar day in `timezone`. `guess` assumes the
 * zone is UTC, then the zone's real offset at that instant is subtracted; the offset is checked a
 * second time at the candidate so a DST shift on the boundary day cannot leave the start an hour
 * off.
 */
export function notificationDayStartFor(day: string, timezone: string): Date {
  const guess = new Date(`${day}T00:00:00Z`);
  const offset = timezoneOffsetMs(guess, timezone);
  const corrected = timezoneOffsetMs(new Date(guess.getTime() - offset), timezone);
  return new Date(guess.getTime() - corrected);
}

/** Wall clock of `instant` in `timezone` mirrored to UTC, minus `instant` (e.g. +7h for Vietnam). */
const timezoneOffsetMs = (instant: Date, timezone: string): number => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (name: string) => Number(parts.find((value) => value.type === name)!.value);
  const wallClock = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wallClock - instant.getTime();
};
