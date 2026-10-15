import { roundHalfAwayFromZero } from '../money';

/**
 * Clawing back points when money for an earning order is refunded (O16 plan step 1). Cumulative
 * and telescoping like `refund-amount.ts`: the target after refunding `R` of merchandise is
 * `round(earned × min(R, base) / base)`, each refund reverses the difference to the previous
 * target, so refunding everything in any split reverses exactly what was earned.
 */
export function reversalTarget(args: {
  earnedPoints: number;
  base: number;
  refundedMerchandise: number;
}): number {
  const { earnedPoints, base } = args;
  if (earnedPoints <= 0 || base <= 0) return 0;
  const refunded = Math.min(Math.max(0, args.refundedMerchandise), base);
  return roundHalfAwayFromZero((earnedPoints * refunded) / base);
}

/**
 * One reversal step. `points` is positive (to be subtracted); `baseAmount` is the merchandise
 * value leaving the customer's 12-month spend (positive too — the ledger stores it negated).
 */
export function reversalStep(args: {
  earnedPoints: number;
  base: number;
  refundedBefore: number;
  refundedAfter: number;
}): { points: number; baseAmount: number } {
  const target = (refundedMerchandise: number) =>
    reversalTarget({ earnedPoints: args.earnedPoints, base: args.base, refundedMerchandise });
  const capped = (value: number) => Math.min(Math.max(0, value), Math.max(0, args.base));
  return {
    points: Math.max(0, target(args.refundedAfter) - target(args.refundedBefore)),
    baseAmount: Math.max(0, capped(args.refundedAfter) - capped(args.refundedBefore)),
  };
}
