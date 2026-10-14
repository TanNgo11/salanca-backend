import { describe, expect, it } from 'vitest';

import { amountOwed, payableTotal, returnedLineAmount } from './payable';

describe('payable amount after line cancels', () => {
  it('leaves the total alone when nothing is canceled', () => {
    expect(payableTotal({ totalAmount: 195000 })).toBe(195000);
    expect(payableTotal({ totalAmount: 195000, canceledAmount: 0 })).toBe(195000);
    expect(amountOwed({ totalAmount: 195000, canceledAmount: null }, 0)).toBe(195000);
  });

  it('drops the canceled share from what is owed', () => {
    const order = { totalAmount: 195000, canceledAmount: 39886 };
    expect(payableTotal(order)).toBe(155114);
    expect(amountOwed(order, 0)).toBe(155114);
    expect(amountOwed(order, 50000)).toBe(105114);
  });

  it('never goes negative once captured covers the payable total', () => {
    expect(amountOwed({ totalAmount: 195000, canceledAmount: 39886 }, 195000)).toBe(0);
    expect(payableTotal({ totalAmount: 100, canceledAmount: 500 })).toBe(0);
  });

  it('counts returned units by the refund core telescoping share', () => {
    expect(
      returnedLineAmount([
        { quantity: 3, returnedQuantity: 1, lineTotalAmount: 39887 },
        { quantity: 1, returnedQuantity: 0, lineTotalAmount: 5000 },
      ]),
    ).toBe(13296);
  });
});
