/** Local calendar day of the last business-day cutoff; independent of the server's timezone. */
export function businessDate(instant: Date, timezone: string, cutoff = '04:00'): string {
  if (!Number.isFinite(instant.getTime())) throw new Error('Invalid business-date instant');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)) throw new Error('Invalid business-day cutoff');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (name: string) => parts.find((value) => value.type === name)!.value;
  const localDate = `${part('year')}-${part('month')}-${part('day')}`;
  if (`${part('hour')}:${part('minute')}` >= cutoff) return localDate;
  const previous = new Date(`${localDate}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}
