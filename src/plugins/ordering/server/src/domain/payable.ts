import { cumulativeRefundedAmount } from './refund-amount';

/**
 * What a customer still has to pay for. `order.totalAmount` is the placement snapshot; canceling
 * units ("hủy một phần món") leaves it alone and adds their telescoped share to
 * `order.canceledAmount`, so the snapshot stays for reconciliation while the amount owed drops.
 * A staff order edit reprices every live unit into a new `totalAmount` and resets the ledger to
 * 0 — units cut earlier are already inside the new total. Returned units never move it: they
 * were delivered and paid, and their money goes back through a refund.
 */
export type PayableOrder = { totalAmount: number; canceledAmount?: number | null };

/** Snapshot total less the canceled share; never negative. */
export function payableTotal(order: PayableOrder): number {
  return Math.max(0, order.totalAmount - (order.canceledAmount ?? 0));
}

/** What is still to collect: payable total less everything captured (refunds are not re-collected). */
export function amountOwed(order: PayableOrder, capturedAmount: number): number {
  return Math.max(0, payableTotal(order) - capturedAmount);
}

export type ReturnedLine = {
  quantity: number;
  pricedQuantity?: number | null;
  returnedQuantity: number;
  lineTotalAmount: number;
};

/** Telescoped value of the units already returned (the refund core's per-line share). */
export function returnedLineAmount(lines: readonly ReturnedLine[]): number {
  return lines.reduce(
    (sum, line) =>
      sum +
      (line.returnedQuantity > 0
        ? cumulativeRefundedAmount(
            line.lineTotalAmount,
            line.pricedQuantity ?? line.quantity,
            line.returnedQuantity,
          )
        : 0),
    0,
  );
}
