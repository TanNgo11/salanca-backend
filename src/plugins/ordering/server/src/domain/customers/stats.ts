import { payableTotal } from '../payable';

export type OrderAmounts = {
  totalAmount: string | number | null;
  canceledAmount?: string | number | null;
};

/**
 * Σ amount owed over the given orders. `biginteger` columns reach JS as strings, so each is coerced
 * before adding — `0 + "45000" + "30000"` is the string "04500030000", which BUG-02 stored.
 */
export const spentOf = (orders: readonly OrderAmounts[]): number =>
  orders.reduce(
    (sum, order) =>
      sum +
      payableTotal({
        totalAmount: Number(order.totalAmount ?? 0),
        canceledAmount: Number(order.canceledAmount ?? 0),
      }),
    0,
  );
