import { assertSafeAmount, roundHalfAwayFromZero } from '../money';

/** Tax configuration snapshot passed into the pipeline; mirrors `config.tax`. */
export type TaxContext = {
  enabled: boolean;
  pricesIncludeTax: boolean;
  defaultCategory: string;
  categories: Record<
    string,
    { label: string; rates: { ratePercent: number; validFrom: string; validTo?: string }[] }
  >;
};

/**
 * Picks the rate of `taxGroupRef` (falling back to the default category) valid at `at`
 * (`validFrom <= at < validTo`, ISO strings compare lexicographically). Returns null when tax
 * is off, the category is unknown, or no rate covers `at`.
 */
export function resolveTaxRate(
  ctx: TaxContext,
  taxGroupRef: string | undefined,
  at: string,
): { category: string; ratePercent: number } | null {
  if (!ctx.enabled) return null;
  const category = taxGroupRef ?? ctx.defaultCategory;
  const entry = ctx.categories[category];
  if (!entry) return null;
  const rate = entry.rates.find(
    (candidate) => candidate.validFrom <= at && (candidate.validTo === undefined || at < candidate.validTo),
  );
  if (!rate) return null;
  return { category, ratePercent: rate.ratePercent };
}

/**
 * Tax inside (inclusive) or on top of (exclusive) an integer amount. `ratePercent` may be
 * fractional; results are rounded half away from zero.
 */
export function taxForLineAmount(amount: number, ratePercent: number, inclusive: boolean): number {
  assertSafeAmount(amount, 'amount');
  if (!Number.isFinite(ratePercent)) {
    throw new RangeError('ratePercent must be finite');
  }
  return inclusive
    ? roundHalfAwayFromZero((amount * ratePercent) / (100 + ratePercent))
    : roundHalfAwayFromZero((amount * ratePercent) / 100);
}
