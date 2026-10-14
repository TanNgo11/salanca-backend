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

/**
 * A line's `lineTotalAmount` covers `pricedQuantity` units (null = all `quantity` units). A staff
 * edit reprices only the live units, so units removed before that pricing are not part of the
 * total: telescoping then runs over the priced units, offset by what was already gone.
 */
export type RemovalLine = {
  quantity: number;
  lineTotalAmount: number;
  pricedQuantity?: number | null;
};

/** Amount for `units` more units leaving a line that already lost `removedBefore` units. */
export function lineRemovalAmount(line: RemovalLine, removedBefore: number, units: number): number {
  const priced = line.pricedQuantity ?? line.quantity;
  const goneBeforePricing = line.quantity - priced;
  return refundLineAmount(
    line.lineTotalAmount,
    priced,
    Math.max(0, removedBefore - goneBeforePricing),
    units,
  );
}

/**
 * What the units still open on a line are worth: its total prorated over the units it was priced
 * for. Unedited lines are priced for all `quantity` units; an edited line for the live units at
 * the edit, and `quantity − canceledQuantity` units are still open now.
 */
export function liveLineAmount(line: RemovalLine & { canceledQuantity: number }): number {
  const priced = line.pricedQuantity ?? line.quantity;
  if (priced <= 0) return 0;
  const open = Math.max(0, line.quantity - line.canceledQuantity);
  return roundHalfAwayFromZero((line.lineTotalAmount * open) / priced);
}
