/**
 * Lot arithmetic (O16 plan step 1). Points live in lots with their own expiry; every change takes
 * or returns points lot by lot so the ledger stays one row per lot touched. Invariants the scripts
 * re-check: `0 ≤ remaining ≤ points`, and Σ remaining = max(0, balance) (a negative balance is a
 * debt that later credit pays off before any lot is left with points).
 */
export type Lot = { id: number; remaining: number; expiresAt: Date };
export type LotTake = { lotId: number; points: number };

/** Soonest expiry first, then the older lot (smaller id) — the FIFO of "dùng lô cũ trước". */
const byExpiryThenId = (a: Lot, b: Lot): number =>
  a.expiresAt.getTime() - b.expiresAt.getTime() || a.id - b.id;

/**
 * Takes `points` from lots: those in `preferredLotIds` first (the order's own lot when clawing
 * back an earn), then the rest FIFO. `shortfall` is what the lots could not cover.
 */
export function takeFromLots(
  lots: readonly Lot[],
  points: number,
  preferredLotIds: readonly number[] = [],
): { takes: LotTake[]; shortfall: number } {
  const preferred = new Set(preferredLotIds);
  const ordered = lots
    .filter((lot) => lot.remaining > 0)
    .sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)) || byExpiryThenId(a, b));
  const takes: LotTake[] = [];
  let left = Math.max(0, points);
  for (const lot of ordered) {
    if (left === 0) break;
    const take = Math.min(lot.remaining, left);
    takes.push({ lotId: lot.id, points: take });
    left -= take;
  }
  return { takes, shortfall: left };
}

export type ReleasePlan = {
  /** Points given back to the lot they came from (still alive). */
  restores: LotTake[];
  /** Lots created for points whose original lot has already expired. */
  newLots: Array<{ fromLotId: number; points: number; expiresAt: Date }>;
};

/**
 * Gives redeemed points back to the lots they were taken from. A lot that has expired meanwhile
 * cannot hold them, so a `restore` lot with `restoreDays` of life is made instead.
 */
export function planRelease(args: {
  takes: readonly LotTake[];
  lots: ReadonlyMap<number, { expiresAt: Date }>;
  now: Date;
  restoreDays: number;
}): ReleasePlan {
  const plan: ReleasePlan = { restores: [], newLots: [] };
  for (const take of args.takes) {
    if (take.points <= 0) continue;
    const lot = args.lots.get(take.lotId);
    if (lot && lot.expiresAt.getTime() > args.now.getTime()) {
      plan.restores.push({ lotId: take.lotId, points: take.points });
    } else {
      plan.newLots.push({
        fromLotId: take.lotId,
        points: take.points,
        expiresAt: addDays(args.now, args.restoreDays),
      });
    }
  }
  return plan;
}

/**
 * `remaining` for a lot created while the balance is `balanceBefore`: a negative balance is a
 * debt, so the first points credited are absorbed by it and never become spendable.
 */
export function lotRemainingAfterDebt(balanceBefore: number, points: number): number {
  return Math.max(0, points - Math.max(0, -balanceBefore));
}

/**
 * Same debt rule for points handed back to existing lots (a release while the balance is
 * negative): trims `amounts` in order, earliest first, by `debt`. Returns the amounts to add to
 * `remaining`.
 */
export function trimByDebt(amounts: readonly number[], debt: number): number[] {
  let left = Math.max(0, debt);
  return amounts.map((amount) => {
    const cut = Math.min(amount, left);
    left -= cut;
    return amount - cut;
  });
}

export function addDays(from: Date, days: number): Date {
  const out = new Date(from.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/** Calendar months in UTC, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(from: Date, months: number): Date {
  const out = new Date(from.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}
