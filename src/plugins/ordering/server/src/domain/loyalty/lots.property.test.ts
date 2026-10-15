import { describe, expect, it } from 'vitest';

import { lotRemainingAfterDebt, planRelease, takeFromLots, type Lot } from './lots';
import { reversalStep } from './reverse';

const mulberry32 = (seed: number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

describe('lot properties (seeded random walk)', () => {
  it('spend then release keeps Σ remaining and never exceeds a lot', () => {
    const random = mulberry32(16);
    const pick = (n: number) => Math.floor(random() * n);
    for (let round = 0; round < 400; round += 1) {
      const now = new Date('2027-01-01T00:00:00Z');
      const lots: Lot[] = Array.from({ length: 1 + pick(5) }, (_, index) => ({
        id: index + 1,
        remaining: pick(200),
        expiresAt: new Date(now.getTime() + (pick(60) - 20) * 86_400_000),
      }));
      const originalPoints = new Map(lots.map((lot) => [lot.id, lot.remaining]));
      const total = lots.reduce((sum, lot) => sum + lot.remaining, 0);
      const want = pick(total + 50);
      const { takes, shortfall } = takeFromLots(lots, want);
      const taken = takes.reduce((sum, take) => sum + take.points, 0);
      expect(taken + shortfall).toBe(want);
      expect(taken).toBeLessThanOrEqual(total);
      for (const take of takes) {
        expect(take.points).toBeGreaterThan(0);
        expect(take.points).toBeLessThanOrEqual(originalPoints.get(take.lotId) ?? 0);
      }
      const plan = planRelease({
        takes,
        lots: new Map(lots.map((lot) => [lot.id, { expiresAt: lot.expiresAt }])),
        now,
        restoreDays: 30,
      });
      const restored =
        plan.restores.reduce((sum, restore) => sum + restore.points, 0) +
        plan.newLots.reduce((sum, lot) => sum + lot.points, 0);
      expect(restored).toBe(taken);
    }
  });

  it('refunding in random splits reverses exactly the earned points', () => {
    const random = mulberry32(1610);
    const pick = (n: number) => Math.floor(random() * n);
    for (let round = 0; round < 400; round += 1) {
      const base = 10_000 * (1 + pick(500));
      const earned = Math.floor(base / 10_000) * (1 + pick(2));
      let before = 0;
      let reversed = 0;
      let spend = 0;
      while (before < base) {
        const next = Math.min(base, before + 1 + pick(base));
        const step = reversalStep({ earnedPoints: earned, base, refundedBefore: before, refundedAfter: next });
        reversed += step.points;
        spend += step.baseAmount;
        before = next;
      }
      expect(reversed).toBe(earned);
      expect(spend).toBe(base);
    }
  });

  it('debt absorption keeps remaining at most max(0, balance)', () => {
    for (const balance of [-50, -1, 0, 1, 80]) {
      for (const points of [1, 30, 100]) {
        const remaining = lotRemainingAfterDebt(balance, points);
        expect(remaining).toBeGreaterThanOrEqual(0);
        expect(remaining).toBeLessThanOrEqual(points);
        expect(remaining).toBe(Math.max(0, balance + points) - Math.max(0, balance));
      }
    }
  });
});
