import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  lotRemainingAfterDebt,
  planRelease,
  takeFromLots,
  trimByDebt,
  type Lot,
} from './lots';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const lot = (id: number, remaining: number, expires: string): Lot => ({ id, remaining, expiresAt: d(expires) });

describe('takeFromLots', () => {
  const lots = [lot(3, 50, '2027-03-01'), lot(1, 40, '2027-01-01'), lot(2, 30, '2027-01-01'), lot(4, 0, '2026-12-01')];

  it('spends the soonest expiry first, older lot on ties, skipping empty lots', () => {
    expect(takeFromLots(lots, 60)).toEqual({
      takes: [
        { lotId: 1, points: 40 },
        { lotId: 2, points: 20 },
      ],
      shortfall: 0,
    });
  });

  it('reports what the lots could not cover', () => {
    expect(takeFromLots(lots, 200)).toEqual({
      takes: [
        { lotId: 1, points: 40 },
        { lotId: 2, points: 30 },
        { lotId: 3, points: 50 },
      ],
      shortfall: 80,
    });
  });

  it('takes preferred lots before the FIFO order', () => {
    expect(takeFromLots(lots, 60, [3])).toEqual({
      takes: [
        { lotId: 3, points: 50 },
        { lotId: 1, points: 10 },
      ],
      shortfall: 0,
    });
  });

  it('does not mutate its input', () => {
    const copy = lots.map((l) => ({ ...l }));
    takeFromLots(lots, 100);
    expect(lots).toEqual(copy);
  });
});

describe('planRelease', () => {
  const now = d('2027-02-01');
  const lots = new Map([
    [1, { expiresAt: d('2027-03-01') }],
    [2, { expiresAt: d('2027-01-15') }],
  ]);

  it('returns points to a live lot and makes a restore lot for an expired one', () => {
    const plan = planRelease({
      takes: [
        { lotId: 1, points: 40 },
        { lotId: 2, points: 20 },
        { lotId: 9, points: 5 },
      ],
      lots,
      now,
      restoreDays: 30,
    });
    expect(plan.restores).toEqual([{ lotId: 1, points: 40 }]);
    expect(plan.newLots).toEqual([
      { fromLotId: 2, points: 20, expiresAt: d('2027-03-03') },
      { fromLotId: 9, points: 5, expiresAt: d('2027-03-03') },
    ]);
  });

  it('treats a lot expiring exactly now as expired', () => {
    const plan = planRelease({
      takes: [{ lotId: 1, points: 10 }],
      lots: new Map([[1, { expiresAt: now }]]),
      now,
      restoreDays: 30,
    });
    expect(plan.restores).toEqual([]);
    expect(plan.newLots).toHaveLength(1);
  });
});

describe('debt', () => {
  it('absorbs credit into a negative balance before any lot keeps points', () => {
    expect(lotRemainingAfterDebt(0, 30)).toBe(30);
    expect(lotRemainingAfterDebt(10, 30)).toBe(30);
    expect(lotRemainingAfterDebt(-6, 30)).toBe(24);
    expect(lotRemainingAfterDebt(-40, 30)).toBe(0);
  });

  it('trims restores by the debt, earliest first', () => {
    expect(trimByDebt([10, 20], 0)).toEqual([10, 20]);
    expect(trimByDebt([10, 20], 15)).toEqual([0, 15]);
    expect(trimByDebt([10, 20], 99)).toEqual([0, 0]);
  });
});

describe('date helpers', () => {
  it('adds days and calendar months, clamping to month end', () => {
    expect(addDays(d('2027-01-31'), 30)).toEqual(d('2027-03-02'));
    expect(addMonths(d('2026-10-15'), 12)).toEqual(d('2027-10-15'));
    expect(addMonths(d('2026-01-31'), 1)).toEqual(d('2026-02-28'));
    expect(addMonths(d('2027-12-31'), 2)).toEqual(d('2028-02-29'));
  });
});
