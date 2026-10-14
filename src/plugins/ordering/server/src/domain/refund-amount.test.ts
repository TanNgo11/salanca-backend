import { describe, expect, it } from 'vitest';

import { lineRemovalAmount, liveLineAmount, refundLineAmount } from './refund-amount';

describe('refundLineAmount (telescoping)', () => {
  it('refunds the whole line total for one unit', () => {
    expect(refundLineAmount(39886, 1, 0, 1)).toBe(39886);
  });

  it('splits 115227 over 2 units as 57614 + 57613', () => {
    expect(refundLineAmount(115227, 2, 0, 1)).toBe(57614);
    expect(refundLineAmount(115227, 2, 1, 1)).toBe(57613);
    expect(refundLineAmount(115227, 2, 0, 2)).toBe(115227);
  });

  it('sums back to the total in any split order (39887 over 3)', () => {
    const whole = 39887;
    const sequential =
      refundLineAmount(whole, 3, 0, 1) +
      refundLineAmount(whole, 3, 1, 1) +
      refundLineAmount(whole, 3, 2, 1);
    const batch = refundLineAmount(whole, 3, 0, 2) + refundLineAmount(whole, 3, 2, 1);
    expect(sequential).toBe(whole);
    expect(batch).toBe(whole);
    expect(refundLineAmount(whole, 3, 0, 3)).toBe(whole);
  });
});

describe('lines priced for fewer units than their quantity (after a staff edit)', () => {
  it('treats an unedited line like the plain telescoping rule', () => {
    expect(lineRemovalAmount({ quantity: 3, lineTotalAmount: 39887 }, 0, 1)).toBe(13296);
    expect(lineRemovalAmount({ quantity: 3, lineTotalAmount: 39887 }, 1, 1)).toBe(13295);
  });

  it('prices a later cancel on the live units, not the original quantity', () => {
    // 3 ordered, 1 cut by the edit, total repriced for the 2 live units.
    const line = { quantity: 3, pricedQuantity: 2, lineTotalAmount: 26342 };
    expect(lineRemovalAmount(line, 1, 1)).toBe(13171);
    expect(lineRemovalAmount(line, 2, 1)).toBe(13171);
    expect(lineRemovalAmount(line, 1, 2)).toBe(26342);
  });

  it('values the open units over the priced units', () => {
    expect(liveLineAmount({ quantity: 3, pricedQuantity: 2, lineTotalAmount: 26342, canceledQuantity: 1 })).toBe(26342);
    expect(liveLineAmount({ quantity: 3, pricedQuantity: 2, lineTotalAmount: 26342, canceledQuantity: 2 })).toBe(13171);
    expect(liveLineAmount({ quantity: 3, lineTotalAmount: 39887, canceledQuantity: 1 })).toBe(26591);
  });
});
