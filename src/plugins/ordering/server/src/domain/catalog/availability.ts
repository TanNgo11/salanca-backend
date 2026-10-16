/**
 * Pure availability rules (contracts §20.1, plan step 5): product `status` + `sellOnline` +
 * branch-local selling windows (including windows crossing midnight) + `catalog-location-state`
 * ("tạm hết") + required bundle components. Everything the caller needs is passed in — the
 * adapter resolves rows, this module decides. `nowLocal` must already be in the branch's
 * timezone.
 */

export type SellingWindow = {
  startTime: string;
  endTime: string;
  /** ISO weekdays 1=Mon … 7=Sun; null/empty = every day. */
  daysOfWeek?: number[] | null;
  validFrom?: string | Date | null;
  validTo?: string | Date | null;
  isActive?: boolean | null;
};

export type LocationState = {
  selling?: boolean | null;
  outOfStockUntil?: string | Date | null;
};

export type AvailabilityInput = {
  status?: string;
  sellOnline?: boolean;
  /** Branch row; absent means "not toggled" → sellable by default. */
  locationState?: LocationState | null;
  /** Union of product windows and every ancestor category window. Empty = no time limit. */
  windows?: SellingWindow[];
  nowLocal?: Date;
  /**
   * The real instant. `nowLocal` is a wall-clock reading built into a `Date` in the process's own
   * zone (see the adapter's `branchLocal`), so it only equals the instant when Node runs on the
   * branch zone. Instants stored on rows (`outOfStockUntil`, window validity) compare against this
   * one; the hour/minute/weekday checks read `nowLocal`. Absent → `nowLocal` is used for both.
   */
  now?: Date;
  /** Branch IANA timezone — callers re-derive `nowLocal` from it when the verdict ages. */
  timezone?: string;
  /** Bundle flag: every item of every required slot must be available for the combo to sell. */
  allRequiredComponentsAvailable?: boolean;
  /** False when any ancestor category is inactive — the whole subtree stops selling. */
  categoryActive?: boolean;
};

export type AvailabilityVerdict = {
  purchasable: boolean;
  /** Machine-readable reasons, empty when purchasable. */
  reasons: string[];
  /** When temporarily out, the moment selling resumes (for "available again at …" UI). */
  resumesAt?: Date;
};

const toTime = (value: string | Date | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? null : time;
};

/** 'HH:mm' or 'HH:mm:ss' → minutes since local midnight. */
export const timeToMinutes = (value: string): number => {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

/** ISO weekday 1=Mon … 7=Sun of a local date. */
const isoDay = (date: Date): number => ((date.getDay() + 6) % 7) + 1;

/**
 * Checks whether `nowLocal` falls inside one window. A window whose start is later than its
 * end crosses midnight (22:00–02:00): before midnight it belongs to the start day, after
 * midnight to the previous day.
 */
export function isWithinSellingWindow(
  nowLocal: Date,
  window: SellingWindow,
  instant: Date = nowLocal,
): boolean {
  if (window.isActive === false) return false;
  const now = instant.getTime();
  const from = toTime(window.validFrom);
  const to = toTime(window.validTo);
  if (from !== null && now < from) return false;
  if (to !== null && now > to) return false;

  const days =
    Array.isArray(window.daysOfWeek) && window.daysOfWeek.length > 0
      ? new Set(window.daysOfWeek)
      : null;
  const start = timeToMinutes(window.startTime);
  const end = timeToMinutes(window.endTime);
  const minutes = nowLocal.getHours() * 60 + nowLocal.getMinutes();
  const today = isoDay(nowLocal);
  const yesterday = isoDay(new Date(nowLocal.getTime() - 24 * 60 * 60 * 1000));

  if (start <= end) {
    return minutes >= start && minutes < end && (days === null || days.has(today));
  }
  if (minutes >= start) return days === null || days.has(today);
  if (minutes < end) return days === null || days.has(yesterday);
  return false;
}

/** Any applicable window containing `nowLocal` → true; empty list → always available. */
export const withinAnyWindow = (
  nowLocal: Date,
  windows: SellingWindow[] = [],
  instant: Date = nowLocal,
): boolean =>
  windows.length === 0 || windows.some((window) => isWithinSellingWindow(nowLocal, window, instant));

/** `instant` rendered as `YYYY-MM-DDTHH:mm:ss` wall time inside an IANA `timezone`. */
export const localPartsInZone = (instant: Date, timezone: string): string => {
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
  const take = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${take('year')}-${take('month')}-${take('day')}T${take('hour')}:${take('minute')}:${take('second')}`;
};

/**
 * The UTC instant whose wall-clock reading in `timezone` equals `localIso`. Iterates the
 * fixed-point refinement — converges in ≤3 steps on any civil timezone, including DST days
 * (a skipped local time lands on the first valid instant after the gap, which is the sane
 * meaning of "04:00" when 04:00 doesn't exist).
 */
export const instantAtLocal = (localIso: string, timezone: string): Date => {
  let guess = Date.parse(`${localIso}Z`);
  for (let i = 0; i < 4; i += 1) {
    const rendered = localPartsInZone(new Date(guess), timezone);
    const diff = Date.parse(`${rendered}Z`) - Date.parse(`${localIso}Z`);
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
};

/**
 * Next occurrence of the business-day cutoff (`'HH:mm'`, e.g. the 04:00 day close) in
 * `timezone` strictly after `now`. "Tạm hết đến hết ngày kinh doanh" resumes at this
 * instant (mockup 5 note 2) — usually early tomorrow morning in branch time.
 */
export const nextBusinessDayCutoff = (now: Date, cutoff: string, timezone: string): Date => {
  const day = localPartsInZone(now, timezone).slice(0, 10);
  const today = instantAtLocal(`${day}T${cutoff}:00`, timezone);
  if (today.getTime() > now.getTime()) return today;
  const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return instantAtLocal(`${nextDay}T${cutoff}:00`, timezone);
};

/** Next occurrence of a staff-entered `'HH:mm'` local time in the branch `timezone`. */
export const nextLocalTime = nextBusinessDayCutoff;

/**
 * The sellable decision. `reasons` stays machine-readable — UI copy maps them to translated
 * strings. `temporarily-unavailable` carries `resumesAt` so staff/guests see when it ends.
 */
export function evaluateAvailability(input: AvailabilityInput): AvailabilityVerdict {
  const reasons: string[] = [];
  let resumesAt: Date | undefined;
  const now = input.nowLocal ?? input.now ?? new Date();
  const instant = input.now ?? now;

  if (input.status !== undefined && input.status !== 'active') {
    reasons.push('not-active');
  }
  if (input.sellOnline === false) {
    reasons.push('not-sell-online');
  }
  const state = input.locationState;
  if (state) {
    const until = toTime(state.outOfStockUntil);
    if (until !== null && until > instant.getTime()) {
      // Active "tạm hết đến …" — reports when selling resumes.
      reasons.push('temporarily-unavailable');
      resumesAt = new Date(until);
    } else if (state.selling === false && until === null) {
      // Indefinite off. An elapsed `outOfStockUntil` auto-resumes even though the row
      // still says selling=false — the timestamp, not the flag, is the source of truth.
      reasons.push('temporarily-unavailable');
    }
  }
  if (input.windows && !withinAnyWindow(now, input.windows, instant)) {
    reasons.push('outside-window');
  }
  if (input.allRequiredComponentsAvailable === false) {
    reasons.push('component-unavailable');
  }
  if (input.categoryActive === false) {
    reasons.push('category-inactive');
  }
  return {
    purchasable: reasons.length === 0,
    reasons: [...new Set(reasons)],
    ...(resumesAt ? { resumesAt } : {}),
  };
}
