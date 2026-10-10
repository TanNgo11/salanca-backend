import { describe, expect, it } from 'vitest';

import { refundLineAmount } from './refund-amount';

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
