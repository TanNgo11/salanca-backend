import { describe, expect, it } from 'vitest';

import { amountOwed, canceledLineAmount, payableTotal, removedLineAmount } from './payable';

const line = (over: Partial<Parameters<typeof canceledLineAmount>[0][number]> = {}) => ({
  quantity: 1,
  returnedQuantity: 0,
  canceledQuantity: 0,
  lineTotalAmount: 39886,
  ...over,
});

describe('payable amount after line cancels', () => {
  it('leaves the total alone when nothing is canceled', () => {
    expect(payableTotal(195000, [line()])).toBe(195000);
    expect(amountOwed(195000, [line()], 0)).toBe(195000);
  });

  it('drops the canceled share from what is owed', () => {
    const lines = [line({ canceledQuantity: 1 }), line({ lineTotalAmount: 155114 })];
    expect(canceledLineAmount(lines)).toBe(39886);
    expect(payableTotal(195000, lines)).toBe(155114);
    expect(amountOwed(195000, lines, 0)).toBe(155114);
    expect(amountOwed(195000, lines, 50000)).toBe(105114);
  });

  it('never goes negative once captured covers the payable total', () => {
    expect(amountOwed(195000, [line({ canceledQuantity: 1 })], 195000)).toBe(0);
  });

  it('telescopes a partly canceled line like the refund core', () => {
    const lines = [line({ quantity: 3, lineTotalAmount: 39887, canceledQuantity: 1 })];
    expect(canceledLineAmount(lines)).toBe(13296);
  });

  it('does not treat returned units as canceled, but counts them as removed', () => {
    const lines = [line({ returnedQuantity: 1 })];
    expect(canceledLineAmount(lines)).toBe(0);
    expect(payableTotal(39886, lines)).toBe(39886);
    expect(removedLineAmount(lines)).toBe(39886);
  });
});
