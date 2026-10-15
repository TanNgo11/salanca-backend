import { roundHalfAwayFromZero } from '../money';

/**
 * Points earned for a completed order (O16 plan step 1). Pure: the service feeds it the live
 * lines, the gift-card money already paid and the customer's tier multiplier.
 */
export type EarnLine = {
  quantity: number;
  pricedQuantity?: number | null;
  canceledQuantity: number;
  baseAmount: number;
  discountAmount: number;
};

/**
 * Merchandise value that earns points: Σ over live lines of `baseAmount + discountAmount`
 * (food after promotions and redeemed points — no fees, rounding, outside tax or tip), prorated
 * over the units still open exactly like `liveLineAmount`. Gift-card money counts as paying for the
 * merchandise first, so it comes off the top; never below 0.
 */
export function earnBase(lines: readonly EarnLine[], giftCardPaid = 0): number {
  const merchandise = lines.reduce((sum, line) => {
    const priced = line.pricedQuantity ?? line.quantity;
    if (priced <= 0) return sum;
    const open = Math.max(0, line.quantity - line.canceledQuantity);
    return sum + roundHalfAwayFromZero(((line.baseAmount + line.discountAmount) * open) / priced);
  }, 0);
  return Math.max(0, merchandise - Math.max(0, giftCardPaid));
}

/**
 * `floor(base × multiplier / (earnPerAmount × 100))` — one floor, so a ×1.0 customer earns
 * `floor(base / earnPerAmount)`. `multiplier` is ×100 (120 = ×1.2).
 */
export function earnPoints(args: { base: number; earnPerAmount: number; multiplier: number }): number {
  const { base, earnPerAmount, multiplier } = args;
  if (base <= 0 || earnPerAmount <= 0 || multiplier <= 0) return 0;
  return Math.floor((base * multiplier) / (earnPerAmount * 100));
}

/** Cuts a day's earning at the cap; the excess is dropped, not carried to the next day. */
export function capDailyEarn(args: { points: number; earnedToday: number; dailyCap: number }): number {
  const room = Math.max(0, args.dailyCap - Math.max(0, args.earnedToday));
  return Math.max(0, Math.min(args.points, room));
}
