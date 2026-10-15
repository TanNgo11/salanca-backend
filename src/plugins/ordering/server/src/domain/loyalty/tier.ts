/** Membership tiers (O16 plan step 1): pick by 12-month spend, move up at once, down after a grace. */
export type Tier = {
  code: string;
  /** Spend over the last 12 months (VND of merchandise) that reaches the tier. */
  minSpend12m: number;
  /** ×100: 100 = ×1.0, 120 = ×1.2. */
  multiplier: number;
  active: boolean;
};

const ascending = (tiers: readonly Tier[]): Tier[] =>
  tiers.filter((tier) => tier.active).sort((a, b) => a.minSpend12m - b.minSpend12m);

/** The highest active tier whose threshold the spend reaches; the lowest tier when none does. */
export function pickTier(tiers: readonly Tier[], spend12m: number): Tier | null {
  const list = ascending(tiers);
  let chosen: Tier | null = list[0] ?? null;
  for (const tier of list) {
    if (spend12m >= tier.minSpend12m) chosen = tier;
  }
  return chosen;
}

/** Next tier up and the spend still missing, or null at the top. */
export function nextTier(
  tiers: readonly Tier[],
  spend12m: number,
): { tier: Tier; missing: number } | null {
  const above = ascending(tiers).find((tier) => tier.minSpend12m > spend12m);
  return above ? { tier: above, missing: above.minSpend12m - spend12m } : null;
}

export type TierDecision =
  | { action: 'keep'; belowSince: null }
  /** Moves up immediately; a customer who climbs back clears the grace mark too. */
  | { action: 'up'; to: Tier; belowSince: null }
  | { action: 'start-grace'; belowSince: Date }
  | { action: 'hold'; belowSince: Date }
  | { action: 'down'; to: Tier; belowSince: null };

/**
 * Decides one customer's tier move. `currentCode` is the tier held now (null = none yet). Going
 * down needs the spend to stay under the held tier's threshold for `graceDays` in a row; reaching
 * it again clears the mark.
 */
export function decideTier(args: {
  tiers: readonly Tier[];
  currentCode: string | null;
  spend12m: number;
  belowSince: Date | null;
  now: Date;
  graceDays: number;
}): TierDecision {
  const target = pickTier(args.tiers, args.spend12m);
  const all = ascending(args.tiers);
  const current =
    args.currentCode === null ? null : (all.find((tier) => tier.code === args.currentCode) ?? null);
  if (!target) return { action: 'keep', belowSince: null };
  if (!current) return { action: 'up', to: target, belowSince: null };
  if (target.minSpend12m > current.minSpend12m) return { action: 'up', to: target, belowSince: null };
  if (target.minSpend12m === current.minSpend12m) return { action: 'keep', belowSince: null };
  if (args.belowSince === null) return { action: 'start-grace', belowSince: args.now };
  const elapsedDays = (args.now.getTime() - args.belowSince.getTime()) / 86_400_000;
  return elapsedDays >= args.graceDays
    ? { action: 'down', to: target, belowSince: null }
    : { action: 'hold', belowSince: args.belowSince };
}
