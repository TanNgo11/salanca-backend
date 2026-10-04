export const AUDIT_LOG_TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const AUDIT_LOG_DEFAULT_DAY_COUNT = 30;
export const AUDIT_LOG_SEARCH_MAX_CALENDAR_DAYS = 366;
export const AUDIT_LOG_EXPORT_MAX_CALENDAR_DAYS = 31;

const pad2 = (value: number): string => String(value).padStart(2, '0');

export interface VietnamCalendarDate {
  day: number;
  month: number;
  year: number;
}

const readPart = (
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number => {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) {
    throw new Error(`Missing ${type} in ${AUDIT_LOG_TIME_ZONE} calendar parts.`);
  }
  return Number(value);
};

export const readVietnamCalendarDate = (instant: Date): VietnamCalendarDate => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: AUDIT_LOG_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  return {
    year: readPart(parts, 'year'),
    month: readPart(parts, 'month'),
    day: readPart(parts, 'day'),
  };
};

export const addVietnamCalendarDays = (
  date: VietnamCalendarDate,
  days: number,
): VietnamCalendarDate => {
  const utcNoon = Date.UTC(date.year, date.month - 1, date.day, 12, 0, 0);
  return readVietnamCalendarDate(new Date(utcNoon + days * 24 * 60 * 60 * 1000));
};

const readLocalClock = (instant: Date): { date: string; time: string } => {
  const stamp = new Intl.DateTimeFormat('sv-SE', {
    timeZone: AUDIT_LOG_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
  const [date, time] = stamp.split(' ');
  return { date, time };
};

export const vietnamLocalMidnightUtc = (
  year: number,
  month: number,
  day: number,
): Date => {
  const isoDate = `${year}-${pad2(month)}-${pad2(day)}`;
  const utcGuess = new Date(`${isoDate}T00:00:00.000Z`);
  const local = readLocalClock(utcGuess);
  const [localYear, localMonth, localDay] = local.date.split('-').map(Number);
  const [localHour, localMinute, localSecond] = local.time.split(':').map(Number);
  const localAsUtcMs = Date.UTC(
    localYear,
    localMonth - 1,
    localDay,
    localHour,
    localMinute,
    localSecond,
  );
  const midnight = new Date(utcGuess.getTime() - (localAsUtcMs - utcGuess.getTime()));
  const verified = readVietnamCalendarDate(midnight);
  if (verified.year !== year || verified.month !== month || verified.day !== day) {
    throw new Error(
      `Failed to resolve ${AUDIT_LOG_TIME_ZONE} midnight for ${isoDate}.`,
    );
  }
  return midnight;
};

export const defaultAuditLogDateRange = (
  now: Date = new Date(),
): { from: string; toExclusive: string } => {
  const today = readVietnamCalendarDate(now);
  const fromDate = addVietnamCalendarDays(today, -(AUDIT_LOG_DEFAULT_DAY_COUNT - 1));
  const toExclusiveDate = addVietnamCalendarDays(today, 1);
  return {
    from: vietnamLocalMidnightUtc(fromDate.year, fromDate.month, fromDate.day).toISOString(),
    toExclusive: vietnamLocalMidnightUtc(
      toExclusiveDate.year,
      toExclusiveDate.month,
      toExclusiveDate.day,
    ).toISOString(),
  };
};

export const calendarDaysBetween = (from: Date, toExclusive: Date): number => {
  const start = readVietnamCalendarDate(from);
  const end = readVietnamCalendarDate(toExclusive);
  const startUtc = Date.UTC(start.year, start.month - 1, start.day);
  const endUtc = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endUtc - startUtc) / (24 * 60 * 60 * 1000));
};

export const formatVietnamDateTime = (iso: string): string =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone: AUDIT_LOG_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
