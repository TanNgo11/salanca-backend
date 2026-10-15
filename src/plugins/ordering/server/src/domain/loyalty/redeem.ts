/** Redeeming points against an order (O16 plan step 1). Pure rules; the service holds the locks. */
export type RedeemRejection =
  | 'not-verified'
  | 'negative-balance'
  | 'below-minimum'
  | 'insufficient'
  | 'over-cap';

/** Share is configured as a fraction (0.5); basis points keep `0.29 × 100` from drifting to 28. */
const shareBasisPoints = (share: number): number => Math.round(Math.min(1, Math.max(0, share)) * 10_000);

/** Most money points may take off an order: `floor(merchandise × share)`. */
export function redeemMoneyCeiling(merchandiseAfterPromotions: number, maxRedeemShare: number): number {
  if (merchandiseAfterPromotions <= 0) return 0;
  return Math.floor((merchandiseAfterPromotions * shareBasisPoints(maxRedeemShare)) / 10_000);
}

/** Most points the order can take, before the customer's balance. */
export function redeemPointsCeiling(args: {
  merchandiseAfterPromotions: number;
  maxRedeemShare: number;
  pointValue: number;
}): number {
  if (args.pointValue <= 0) return 0;
  return Math.floor(redeemMoneyCeiling(args.merchandiseAfterPromotions, args.maxRedeemShare) / args.pointValue);
}

export const redeemAmount = (points: number, pointValue: number): number => points * pointValue;

export type RedeemCheck =
  | { ok: true; points: number; amount: number }
  | { ok: false; reason: RedeemRejection };

/** Why a requested redemption is (not) allowed. First failing rule wins, in this order. */
export function checkRedeem(args: {
  points: number;
  balance: number;
  verified: boolean;
  minRedeemPoints: number;
  maxPoints: number;
  pointValue: number;
}): RedeemCheck {
  if (!args.verified) return { ok: false, reason: 'not-verified' };
  if (args.balance < 0) return { ok: false, reason: 'negative-balance' };
  if (!Number.isInteger(args.points) || args.points < args.minRedeemPoints) {
    return { ok: false, reason: 'below-minimum' };
  }
  if (args.points > args.balance) return { ok: false, reason: 'insufficient' };
  if (args.points > args.maxPoints) return { ok: false, reason: 'over-cap' };
  return { ok: true, points: args.points, amount: redeemAmount(args.points, args.pointValue) };
}

/** What a quote tells the customer they may redeem: `max` is 0 when even `min` does not fit. */
export function redeemableRange(args: {
  balance: number;
  minRedeemPoints: number;
  maxPoints: number;
  pointValue: number;
}): { min: number; max: number; value: number } {
  const max = Math.max(0, Math.min(Math.max(0, args.balance), args.maxPoints));
  return {
    min: args.minRedeemPoints,
    max: max >= args.minRedeemPoints ? max : 0,
    value: args.pointValue,
  };
}
