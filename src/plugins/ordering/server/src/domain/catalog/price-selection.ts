import { amountFromDb } from '../money';

/**
 * Pure `catalog-price` selection (contracts §20.1, plan step 5): pick the most specific price
 * row for the request context — a Medusa-style "rules must all match, more rule keys win" —
 * with V1 rule vocabulary limited to `locationRef`, `channel`, `customerGroup` and a
 * `validFrom`/`validTo` sales window. No Strapi imports; callers pass raw rows.
 */

export type CatalogPriceRow = {
  amount: number | string | bigint;
  compareAtAmount?: number | string | bigint | null;
  currency: string;
  minQuantity?: number | null;
  rules?: {
    locationRef?: string | null;
    channel?: string | null;
    customerGroup?: string | null;
  } | null;
  priority?: number | null;
  validFrom?: string | Date | null;
  validTo?: string | Date | null;
};

export type PriceContext = {
  at?: Date;
  locationRef?: string | null;
  channel?: string | null;
  customerGroup?: string | null;
  quantity?: number;
};

export type SelectedPrice = {
  amount: number;
  compareAtAmount?: number;
  currency: string;
  /** Rule keys this row matched — used by diagnostics and tests. */
  matchedRules: string[];
};

const RULE_KEYS = ['locationRef', 'channel', 'customerGroup'] as const;
type RuleKey = (typeof RULE_KEYS)[number];

const toTime = (value: string | Date | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? null : time;
};

/** One rule key present on the row but absent/mismatched in context disqualifies the row. */
const matchScore = (
  row: CatalogPriceRow,
  ctx: PriceContext,
): { score: number; matched: string[] } | null => {
  const rules = row.rules ?? {};
  const matched: string[] = [];
  for (const key of RULE_KEYS) {
    const wanted = rules[key];
    if (wanted === undefined || wanted === null || wanted === '') continue;
    const got = ctx[key as RuleKey];
    if (got === undefined || got === null || got !== wanted) return null;
    matched.push(key);
  }
  return { score: matched.length, matched };
};

/**
 * Returns the winning row or null. Ordering: rule specificity (more matched keys) → explicit
 * `priority` → `minQuantity` (a higher threshold is more specific) → lowest amount, which
 * keeps ties deterministic without surprising totals.
 */
export function selectCatalogPrice(
  rows: CatalogPriceRow[],
  ctx: PriceContext = {},
): SelectedPrice | null {
  const now = (ctx.at ?? new Date()).getTime();
  const quantity = ctx.quantity ?? 1;
  let best: { row: CatalogPriceRow; score: number; matched: string[] } | null = null;
  for (const row of rows) {
    const from = toTime(row.validFrom);
    const to = toTime(row.validTo);
    if (from !== null && now < from) continue;
    if (to !== null && now > to) continue;
    if ((row.minQuantity ?? 1) > quantity) continue;
    const match = matchScore(row, ctx);
    if (!match) continue;
    const amount = amountFromDb(row.amount);
    const beat = () => {
      if (!best) return true;
      if (match.score !== best.score) return match.score > best.score;
      if ((row.priority ?? 0) !== (best.row.priority ?? 0)) {
        return (row.priority ?? 0) > (best.row.priority ?? 0);
      }
      if ((row.minQuantity ?? 1) !== (best.row.minQuantity ?? 1)) {
        return (row.minQuantity ?? 1) > (best.row.minQuantity ?? 1);
      }
      return amount < amountFromDb(best.row.amount);
    };
    if (beat()) best = { row, score: match.score, matched: match.matched };
  }
  if (!best) return null;
  const compareAt =
    best.row.compareAtAmount === null || best.row.compareAtAmount === undefined
      ? undefined
      : amountFromDb(best.row.compareAtAmount);
  return {
    amount: amountFromDb(best.row.amount),
    ...(compareAt !== undefined ? { compareAtAmount: compareAt } : {}),
    currency: best.row.currency,
    matchedRules: best.matched,
  };
}
