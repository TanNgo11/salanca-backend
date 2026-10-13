import { roundHalfAwayFromZero } from '../money';
import type { BranchFee } from '../branch-settings';
import type { PricingAdjustmentInput } from './pipeline';

/**
 * Snapshot stored on the order-adjustment row (ruleSnapshot.branchFee) so order-edit can
 * recompute a percent fee on the edited subtotal, and drop the fee when the order moves to a
 * receive kind the fee does not cover or below its minimum.
 */
export type BranchFeeSnapshot = {
  branchFee: {
    percent: number | null;
    amount: number | null;
    receiveKinds: string[];
    minSubtotal: number | null;
  };
};

/** Amount a discount adjustment contributes to the merchandise base (0 for non-discounts). */
const discountEffect = (
  adjustment: Pick<PricingAdjustmentInput, 'kind' | 'amount' | 'percent' | 'target'>,
  lineBases: number[],
): number => {
  if (adjustment.kind !== 'discount' || adjustment.target?.kind === 'fulfillment') return 0;
  if (adjustment.amount !== undefined) return adjustment.amount;
  const indexes =
    adjustment.target?.kind === 'lines'
      ? adjustment.target.lineIndexes
      : lineBases.map((_, index) => index);
  const base = indexes.reduce((sum, index) => sum + (lineBases[index] ?? 0), 0);
  return -Math.abs(roundHalfAwayFromZero((base * (adjustment.percent ?? 0)) / 100));
};

/**
 * Merchandise subtotal after merchandise discounts — the percent base for O12 branch fees.
 * Fulfillment discounts never reach it (they price the delivery fee, not the food).
 */
export const discountedMerchandise = (
  lineBases: number[],
  adjustments: Array<Pick<PricingAdjustmentInput, 'kind' | 'amount' | 'percent' | 'target'>>,
): number =>
  lineBases.reduce((sum, base) => sum + base, 0) +
  adjustments.reduce((sum, adjustment) => sum + discountEffect(adjustment, lineBases), 0);

/**
 * Resolved fee amount, or null when the fee does not apply: the receive kind is not covered,
 * or the merchandise subtotal is below `minSubtotal`. A percent fee prices on the discounted
 * merchandise base (never below zero); a flat fee is returned as configured.
 */
export const branchFeeAmount = (
  fee: {
    percent?: number | null;
    amount?: number | null;
    minSubtotal?: number | null;
    receiveKinds: readonly string[];
  },
  args: { receiveKind: string; merchandiseSubtotal: number; discountedSubtotal: number },
): number | null => {
  if (!fee.receiveKinds.includes(args.receiveKind)) return null;
  if (
    fee.minSubtotal !== undefined &&
    fee.minSubtotal !== null &&
    args.merchandiseSubtotal < fee.minSubtotal
  ) {
    return null;
  }
  if (fee.amount !== undefined && fee.amount !== null) return fee.amount;
  if (fee.percent === undefined || fee.percent === null) return null;
  return roundHalfAwayFromZero((Math.max(0, args.discountedSubtotal) * fee.percent) / 100);
};

/**
 * Branch `fees` → pipeline `fee` adjustments (decisions: `sourceRef = fee:<code>`, percent on
 * the discounted merchandise subtotal). Fees land after every discount in the adjustment
 * order, so each fee row carries the snapshot the order-edit recompute needs.
 */
export const branchFeeAdjustments = (
  fees: readonly BranchFee[],
  args: {
    receiveKind: string;
    merchandiseSubtotal: number;
    discountedSubtotal: number;
    labelFor: (fee: BranchFee) => string;
  },
): PricingAdjustmentInput[] => {
  const out: PricingAdjustmentInput[] = [];
  for (const fee of fees) {
    const amount = branchFeeAmount(fee, args);
    if (amount === null) continue;
    out.push({
      kind: 'fee',
      code: fee.code,
      label: args.labelFor(fee),
      amount,
      taxable: fee.taxable,
      // Sort after every discount; ties keep the branch's configured order.
      priority: 1_000,
      sourceRef: `fee:${fee.code}`,
      ruleSnapshot: {
        branchFee: {
          percent: fee.percent ?? null,
          amount: fee.amount ?? null,
          receiveKinds: [...fee.receiveKinds],
          minSubtotal: fee.minSubtotal ?? null,
        },
      } satisfies BranchFeeSnapshot,
    });
  }
  return out;
};
