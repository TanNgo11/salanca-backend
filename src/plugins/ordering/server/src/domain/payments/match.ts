import { assertSafeAmount } from '../money';

/**
 * Pure SePay match (contracts §19.1). Signature and timestamp are checked before this runs.
 * Every condition is required for `auto-matched`. Anything else is `needs-review` and must not
 * change the order. `review-all` still reviews a transfer that would otherwise match, with a
 * reason outside the seven mismatch reasons.
 *
 * Order of checks: money-out, no code, unknown order, account, closed, already paid, amount, mode.
 */

export const REVIEW_REASONS = [
  'no-code',
  'order-not-found',
  'underpaid',
  'overpaid',
  'order-closed',
  'already-paid',
  'account-mismatch',
] as const;

export type ReviewReason = (typeof REVIEW_REASONS)[number];

/** Group statuses that mean the order can no longer take a payment (terminal cancel). */
export const CLOSED_GROUP_STATUSES = ['canceled', 'expired', 'rejected'] as const;

export type MatchOrder = {
  code: string;
  locationRef: string;
  status: string;
  totalAmount: number;
  capturedAmount: number;
};

export type MatchInput = {
  transferType: 'in' | 'out';
  /** Code already extracted from the memo. Null when the description has no code. */
  orderCode: string | null;
  order: MatchOrder | null;
  amount: number;
  amountTolerance: number;
  /** Receiving account is configured for `order.locationRef`. Ignored when there is no order. */
  accountBelongsToBranch: boolean;
  captureMode: 'auto' | 'review-all';
};

export type MatchDecision =
  | { outcome: 'ignored' }
  | { outcome: 'auto-matched'; orderCode: string; dueAmount: number }
  | {
      outcome: 'needs-review';
      reviewReason: ReviewReason | 'review-all';
      orderCode: string | null;
      dueAmount: number | null;
    };

export const amountDue = (totalAmount: number, capturedAmount: number): number =>
  Math.max(0, assertSafeAmount(totalAmount, 'totalAmount') - assertSafeAmount(capturedAmount, 'capturedAmount'));

const review = (
  reviewReason: ReviewReason | 'review-all',
  orderCode: string | null,
  dueAmount: number | null,
): MatchDecision => ({ outcome: 'needs-review', reviewReason, orderCode, dueAmount });

export const matchTransfer = (input: MatchInput): MatchDecision => {
  if (input.transferType === 'out') return { outcome: 'ignored' };
  if (!input.orderCode) return review('no-code', null, null);

  const order = input.order;
  if (!order || order.code !== input.orderCode) return review('order-not-found', input.orderCode, null);
  if (!input.accountBelongsToBranch) return review('account-mismatch', order.code, null);

  const due = amountDue(order.totalAmount, order.capturedAmount);
  if ((CLOSED_GROUP_STATUSES as readonly string[]).includes(order.status)) {
    return review('order-closed', order.code, due);
  }
  if (due <= 0) return review('already-paid', order.code, due);

  const amount = assertSafeAmount(input.amount, 'amount');
  const tolerance = assertSafeAmount(input.amountTolerance, 'amountTolerance');
  if (amount < 0) return review('underpaid', order.code, due);
  if (amount < due - tolerance) return review('underpaid', order.code, due);
  if (amount > due + tolerance) return review('overpaid', order.code, due);
  if (input.captureMode === 'review-all') return review('review-all', order.code, due);
  return { outcome: 'auto-matched', orderCode: order.code, dueAmount: due };
};
