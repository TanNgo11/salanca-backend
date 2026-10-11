/**
 * Display helpers for the ordering Admin (screens conventions): money as `175.000đ`, times in the
 * BRANCH timezone (never the viewer's machine), relative "5 phút trước".
 */
export const formatMoney = (amount: number | null | undefined): string =>
  `${new Intl.NumberFormat('vi-VN').format(Math.round(amount ?? 0))}đ`;

const parts = (iso: string, timezone: string, options: Intl.DateTimeFormatOptions) => {
  const values = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hourCycle: 'h23', ...options }).formatToParts(
    new Date(iso),
  );
  return (type: string) => values.find((part) => part.type === type)?.value ?? '';
};

/** `12:30` in the branch timezone. */
export const formatTime = (iso: string | null | undefined, timezone = 'Asia/Ho_Chi_Minh'): string => {
  if (!iso) return '—';
  const part = parts(iso, timezone, { hour: '2-digit', minute: '2-digit' });
  return `${part('hour')}:${part('minute')}`;
};

/** `12:30 · 12/10` in the branch timezone. */
export const formatDateTime = (iso: string | null | undefined, timezone = 'Asia/Ho_Chi_Minh'): string => {
  if (!iso) return '—';
  const part = parts(iso, timezone, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  return `${part('hour')}:${part('minute')} · ${part('day')}/${part('month')}`;
};

/** `dd/MM` of a `YYYY-MM-DD` business date. */
export const formatBusinessDate = (date: string | null | undefined): string => {
  if (!date) return '—';
  const [, month, day] = date.split('-');
  return `${day}/${month}`;
};

export const minutesSince = (iso: string, now = Date.now()): number =>
  Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));

/** Today's business date in a timezone with a `HH:mm` cutoff (mirrors the server rule). */
export const businessDateToday = (timezone = 'Asia/Ho_Chi_Minh', cutoff = '04:00', now = new Date()): string => {
  const part = parts(now.toISOString(), timezone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  if (`${part('hour')}:${part('minute')}` >= cutoff) return date;
  const previous = new Date(`${date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
};

/** Picks the viewer's language from a `{ vi, en }` object, falling back to any non-empty value. */
export const localized = (value: unknown, locale: string): string => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, string>;
  return record[locale] || record.vi || record.en || Object.values(record).find(Boolean) || '';
};
