import type { OrderPaymentStatus } from '../contracts/entities';
import { assertSafeAmount } from './money';

/**
 * Order-level payment status from gross aggregates. Refunds win over the capture comparison:
 * a fully refunded payment reads `refunded` even though `captured` still covers the total
 * (capture stays gross; the refund side is tracked separately).
 */
export function projectPaymentStatus(input: {
  totalAmount: number;
  /** Total owed after canceled units; defaults to `totalAmount`. Overpaid still compares to the snapshot. */
  payableAmount?: number;
  capturedAmount: number;
  refundedAmount: number;
}): OrderPaymentStatus {
  const total = assertSafeAmount(input.totalAmount, 'totalAmount');
  const captured = assertSafeAmount(input.capturedAmount, 'capturedAmount');
  const refunded = assertSafeAmount(input.refundedAmount, 'refundedAmount');
  if (captured === 0) return 'unpaid';
  if (refunded > 0) return refunded >= captured ? 'refunded' : 'partially-refunded';
  const payable = Math.min(
    total,
    input.payableAmount === undefined ? total : assertSafeAmount(input.payableAmount, 'payableAmount'),
  );
  if (captured < payable) return 'partially-paid';
  if (captured <= total) return 'paid';
  return 'overpaid';
}
