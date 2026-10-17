const pad = (value: number) => String(value).padStart(2, '0');

/** "GMT+07:00" for a zone `minutesEast` of UTC (negative = west). */
export const offsetLabel = (minutesEast: number): string => {
  const sign = minutesEast < 0 ? '-' : '+';
  const abs = Math.abs(minutesEast);
  return `GMT${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

/** The browser's current offset, e.g. "GMT+07:00"; `datetime-local` inputs are read in this zone. */
export const browserOffsetLabel = (date: Date = new Date()): string => offsetLabel(-date.getTimezoneOffset());
