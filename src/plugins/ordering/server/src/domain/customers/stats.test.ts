import { describe, expect, it } from 'vitest';

import { spentOf } from './stats';

describe('spentOf', () => {
  it('adds bigint strings as numbers, not as text', () => {
    expect(spentOf([{ totalAmount: '45000' }, { totalAmount: '30000' }])).toBe(75000);
  });
  it('nets line cancels and tolerates null / missing canceledAmount', () => {
    expect(
      spentOf([
        { totalAmount: '100000', canceledAmount: '25000' },
        { totalAmount: 30000, canceledAmount: null },
      ]),
    ).toBe(105000);
  });
  it('never goes negative for an over-cancelled order', () => {
    expect(spentOf([{ totalAmount: 10000, canceledAmount: 20000 }])).toBe(0);
  });
  it('is zero for no orders', () => {
    expect(spentOf([])).toBe(0);
  });
});
