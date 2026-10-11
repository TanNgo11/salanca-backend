/**
 * Branch-local ↔ UTC conversions with `Intl` only (no timezone library). Every schedule rule is
 * expressed in the branch's IANA timezone (contracts §9); storage is always UTC.
 */
export type LocalParts = { date: string; time: string; weekday: number };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatter = (timezone: string): Intl.DateTimeFormat => {
  let cached = formatterCache.get(timezone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    });
    formatterCache.set(timezone, cached);
  }
  return cached;
};

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** Local calendar date (`YYYY-MM-DD`), time (`HH:mm`) and weekday (Mon = 0) of an instant. */
export function toLocalParts(instant: Date, timezone: string): LocalParts {
  const parts = formatter(timezone).formatToParts(instant);
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
    weekday: WEEKDAY_INDEX[part('weekday')] ?? 0,
  };
}

/** Offset (minutes, local − UTC) of `timezone` at `instant`. */
const offsetMinutes = (instant: Date, timezone: string): number => {
  const parts = formatter(timezone).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
};

/**
 * UTC instant of a branch-local wall time. Two passes settle the offset around DST changes
 * (Vietnam has none; the loop keeps the helper correct for other installs).
 */
export function localToUtc(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let guess = naive - offsetMinutes(new Date(naive), timezone) * 60_000;
  guess = naive - offsetMinutes(new Date(guess), timezone) * 60_000;
  return new Date(guess);
}

/** `YYYY-MM-DD` plus `days` (calendar arithmetic, timezone-free). */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export const minutesOf = (time: string): number => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};
