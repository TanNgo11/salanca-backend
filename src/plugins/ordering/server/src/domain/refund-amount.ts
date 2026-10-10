import { roundHalfAwayFromZero } from './money';

/**
 * Refund amounts are computed as a telescoping difference of cumulative shares:
 * `cumulative(k) = round(lineTotal × k / quantity)` and a refund of `q` units after `k0`
 * already-refunded units is `cumulative(k0 + q) − cumulative(k0)`. Refunding all units — in
 * any order or split — returns exactly `lineTotalAmount`; no remainder is ever left over.
 */
export function cumulativeRefundedAmount(
  lineTotalAmount: number,
  quantity: number,
  refundedUnits: number,
): number {
  return roundHalfAwayFromZero((lineTotalAmount * refundedUnits) / quantity);
}

export function refundLineAmount(
  lineTotalAmount: number,
  quantity: number,
  alreadyRefundedUnits: number,
  refundUnits: number,
): number {
  return (
    cumulativeRefundedAmount(lineTotalAmount, quantity, alreadyRefundedUnits + refundUnits) -
    cumulativeRefundedAmount(lineTotalAmount, quantity, alreadyRefundedUnits)
  );
}
