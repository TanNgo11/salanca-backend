import { describe, expect, it } from 'vitest';

import { decideTier, nextTier, pickTier, type Tier } from './tier';

const tiers: Tier[] = [
  { code: 'vang', minSpend12m: 5_000_000, multiplier: 150, active: true },
  { code: 'thanh-vien', minSpend12m: 0, multiplier: 100, active: true },
  { code: 'bac', minSpend12m: 2_000_000, multiplier: 120, active: true },
];
const now = new Date('2027-01-31T00:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe('pickTier / nextTier', () => {
  it('picks the highest tier the spend reaches, independent of input order', () => {
    expect(pickTier(tiers, 0)?.code).toBe('thanh-vien');
    expect(pickTier(tiers, 1_999_999)?.code).toBe('thanh-vien');
    expect(pickTier(tiers, 2_000_000)?.code).toBe('bac');
    expect(pickTier(tiers, 9_000_000)?.code).toBe('vang');
  });

  it('ignores inactive tiers and falls back to the lowest', () => {
    const off = tiers.map((t) => (t.code === 'bac' ? { ...t, active: false } : t));
    expect(pickTier(off, 3_000_000)?.code).toBe('thanh-vien');
    expect(pickTier([], 100)).toBeNull();
  });

  it('reports the next tier and the spend missing', () => {
    expect(nextTier(tiers, 1_500_000)).toMatchObject({ tier: { code: 'bac' }, missing: 500_000 });
    expect(nextTier(tiers, 5_000_000)).toBeNull();
  });
});

describe('decideTier', () => {
  const base = { tiers, now, graceDays: 30 };

  it('moves up at once and clears any grace mark', () => {
    expect(
      decideTier({ ...base, currentCode: 'thanh-vien', spend12m: 2_100_000, belowSince: daysAgo(3) }),
    ).toMatchObject({ action: 'up', to: { code: 'bac' }, belowSince: null });
    expect(decideTier({ ...base, currentCode: null, spend12m: 10, belowSince: null })).toMatchObject({
      action: 'up',
      to: { code: 'thanh-vien' },
    });
  });

  it('keeps the tier and clears the mark when the spend is back at the held tier', () => {
    expect(decideTier({ ...base, currentCode: 'bac', spend12m: 2_500_000, belowSince: daysAgo(10) })).toEqual({
      action: 'keep',
      belowSince: null,
    });
  });

  it('starts a grace, holds inside it, and drops after it', () => {
    expect(decideTier({ ...base, currentCode: 'bac', spend12m: 1_000_000, belowSince: null })).toEqual({
      action: 'start-grace',
      belowSince: now,
    });
    const since = daysAgo(29);
    expect(decideTier({ ...base, currentCode: 'bac', spend12m: 1_000_000, belowSince: since })).toEqual({
      action: 'hold',
      belowSince: since,
    });
    expect(
      decideTier({ ...base, currentCode: 'bac', spend12m: 1_000_000, belowSince: daysAgo(30) }),
    ).toMatchObject({ action: 'down', to: { code: 'thanh-vien' }, belowSince: null });
  });

  it('drops straight to the tier the spend supports', () => {
    expect(
      decideTier({ ...base, currentCode: 'vang', spend12m: 2_500_000, belowSince: daysAgo(40) }),
    ).toMatchObject({ action: 'down', to: { code: 'bac' } });
  });

  it('treats a tier code no longer active as no tier held', () => {
    expect(decideTier({ ...base, currentCode: 'gone', spend12m: 2_500_000, belowSince: null })).toMatchObject({
      action: 'up',
      to: { code: 'bac' },
    });
  });
});
