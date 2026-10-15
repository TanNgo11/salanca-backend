import { describe, expect, it } from 'vitest';

import { reversalStep, reversalTarget } from './reverse';

describe('reversalTarget', () => {
  it('prorates earned points by the refunded share of merchandise', () => {
    expect(reversalTarget({ earnedPoints: 30, base: 300_000, refundedMerchandise: 100_000 })).toBe(10);
    expect(reversalTarget({ earnedPoints: 30, base: 300_000, refundedMerchandise: 300_000 })).toBe(30);
  });

  it('caps at the base and is 0 when nothing was earned', () => {
    expect(reversalTarget({ earnedPoints: 30, base: 300_000, refundedMerchandise: 999_999 })).toBe(30);
    expect(reversalTarget({ earnedPoints: 0, base: 300_000, refundedMerchandise: 100_000 })).toBe(0);
    expect(reversalTarget({ earnedPoints: 30, base: 0, refundedMerchandise: 100 })).toBe(0);
  });
});

describe('reversalStep telescoping', () => {
  const walk = (earned: number, base: number, refunds: number[]) => {
    let before = 0;
    let points = 0;
    let spend = 0;
    for (const refund of refunds) {
      const step = reversalStep({
        earnedPoints: earned,
        base,
        refundedBefore: before,
        refundedAfter: before + refund,
      });
      points += step.points;
      spend += step.baseAmount;
      before += refund;
    }
    return { points, spend };
  };

  it('refunding everything in any split reverses exactly what was earned', () => {
    for (const splits of [[300_000], [100_000, 200_000], [33_333, 33_333, 33_334, 100_000, 100_000], [1, 299_999]]) {
      expect(walk(30, 300_000, splits)).toEqual({ points: 30, spend: 300_000 });
    }
  });

  it('never reverses more than earned when refunds overshoot the base', () => {
    expect(walk(30, 300_000, [200_000, 200_000])).toEqual({ points: 30, spend: 300_000 });
  });

  it('is monotone: a later step never returns points', () => {
    expect(
      reversalStep({ earnedPoints: 7, base: 70_000, refundedBefore: 40_000, refundedAfter: 40_000 }),
    ).toEqual({ points: 0, baseAmount: 0 });
  });
});
