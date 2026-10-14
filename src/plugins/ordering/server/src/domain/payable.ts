import { cumulativeRefundedAmount } from './refund-amount';

/**
 * The amount a customer still has to pay for. `order.totalAmount` is an immutable placement
 * snapshot; canceling units ("hủy một phần món") removes their allocated share from what is owed
 * without touching that snapshot. Returned units do not reduce it: those were delivered and paid,
 * and their money goes back through a refund. The share per line telescopes exactly like the
 * refund amount, so Σ canceled shares never drifts from the refund core.
 */
export type PayableLine = {
  quantity: number;
  returnedQuantity: number;
  canceledQuantity: number;
  lineTotalAmount: number;
};

export function canceledLineAmount(lines: readonly PayableLine[]): number {
  return lines.reduce(
    (sum, line) =>
      sum +
      (line.canceledQuantity > 0
        ? cumulativeRefundedAmount(
            line.lineTotalAmount,
            line.quantity,
            line.returnedQuantity + line.canceledQuantity,
          ) - cumulativeRefundedAmount(line.lineTotalAmount, line.quantity, line.returnedQuantity)
        : 0),
    0,
  );
}

/** Value of every unit that left the order, canceled or returned (the refund core's telescoped share). */
export function removedLineAmount(lines: readonly PayableLine[]): number {
  return lines.reduce(
    (sum, line) =>
      sum +
      cumulativeRefundedAmount(
        line.lineTotalAmount,
        line.quantity,
        line.returnedQuantity + line.canceledQuantity,
      ),
    0,
  );
}

/** Snapshot total minus the share of canceled units; never negative. */
export function payableTotal(totalAmount: number, lines: readonly PayableLine[]): number {
  return Math.max(0, totalAmount - canceledLineAmount(lines));
}

/** What is still to collect: payable total less everything captured (refunds are not re-collected). */
export function amountOwed(
  totalAmount: number,
  lines: readonly PayableLine[],
  capturedAmount: number,
): number {
  return Math.max(0, payableTotal(totalAmount, lines) - capturedAmount);
}
