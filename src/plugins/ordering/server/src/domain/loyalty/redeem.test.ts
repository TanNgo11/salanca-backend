import { describe, expect, it } from 'vitest';

import { checkRedeem, redeemableRange, redeemMoneyCeiling, redeemPointsCeiling } from './redeem';

const base = { balance: 1_000, verified: true, minRedeemPoints: 50, maxPoints: 300, pointValue: 100 };

describe('redeem ceiling', () => {
  it('floors merchandise × share in money, then in points', () => {
    expect(redeemMoneyCeiling(300_000, 0.5)).toBe(150_000);
    expect(redeemMoneyCeiling(100_001, 0.5)).toBe(50_000);
    // 0.29 × 100 is 28.999… in floating point; basis points keep it at 29.
    expect(redeemMoneyCeiling(100, 0.29)).toBe(29);
    expect(redeemMoneyCeiling(0, 0.5)).toBe(0);
    expect(redeemMoneyCeiling(-5, 0.5)).toBe(0);
    expect(redeemPointsCeiling({ merchandiseAfterPromotions: 300_000, maxRedeemShare: 0.5, pointValue: 100 })).toBe(
      1_500,
    );
    expect(redeemPointsCeiling({ merchandiseAfterPromotions: 30_099, maxRedeemShare: 0.5, pointValue: 100 })).toBe(
      150,
    );
  });
});

describe('checkRedeem', () => {
  it('accepts a request inside every limit and prices it', () => {
    expect(checkRedeem({ ...base, points: 100 })).toEqual({ ok: true, points: 100, amount: 10_000 });
  });

  it('rejects in a fixed order, naming the first failing rule', () => {
    expect(checkRedeem({ ...base, points: 100, verified: false })).toEqual({ ok: false, reason: 'not-verified' });
    expect(checkRedeem({ ...base, points: 100, balance: -1 })).toEqual({ ok: false, reason: 'negative-balance' });
    expect(checkRedeem({ ...base, points: 49 })).toEqual({ ok: false, reason: 'below-minimum' });
    expect(checkRedeem({ ...base, points: 1.5 })).toEqual({ ok: false, reason: 'below-minimum' });
    expect(checkRedeem({ ...base, points: 1_001 })).toEqual({ ok: false, reason: 'insufficient' });
    expect(checkRedeem({ ...base, points: 301 })).toEqual({ ok: false, reason: 'over-cap' });
    expect(checkRedeem({ ...base, points: 300 }).ok).toBe(true);
  });
});

describe('redeemableRange', () => {
  it('limits by balance and cap, and reports max 0 when the minimum does not fit', () => {
    expect(redeemableRange({ balance: 1_000, minRedeemPoints: 50, maxPoints: 300, pointValue: 100 })).toEqual({
      min: 50,
      max: 300,
      value: 100,
    });
    expect(redeemableRange({ balance: 120, minRedeemPoints: 50, maxPoints: 300, pointValue: 100 }).max).toBe(120);
    expect(redeemableRange({ balance: 40, minRedeemPoints: 50, maxPoints: 300, pointValue: 100 }).max).toBe(0);
    expect(redeemableRange({ balance: 900, minRedeemPoints: 50, maxPoints: 30, pointValue: 100 }).max).toBe(0);
    expect(redeemableRange({ balance: -20, minRedeemPoints: 50, maxPoints: 300, pointValue: 100 }).max).toBe(0);
  });
});
