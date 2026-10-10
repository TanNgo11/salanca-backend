import { describe, expect, it } from 'vitest';

import {
  type SellingWindow,
  evaluateAvailability,
  instantAtLocal,
  isWithinSellingWindow,
  localPartsInZone,
  nextBusinessDayCutoff,
  timeToMinutes,
} from './availability';

/** `now` is the branch-local instant — tests construct local Date values directly. */
const local = (iso: string) => new Date(iso);

describe('timeToMinutes', () => {
  it('parses HH:mm and HH:mm:ss', () => {
    expect(timeToMinutes('07:30')).toBe(450);
    expect(timeToMinutes('22:00:00')).toBe(1320);
    expect(timeToMinutes('02:00')).toBe(120);
  });
});

describe('isWithinSellingWindow', () => {
  const lunch: SellingWindow = { startTime: '10:30', endTime: '14:00' };
  const cases: [string, SellingWindow, string, boolean][] = [
    ['inside standard window', lunch, '2026-10-10T11:00:00', true],
    ['at the start edge', lunch, '2026-10-10T10:30:00', true],
    ['at the end edge (exclusive)', lunch, '2026-10-10T14:00:00', false],
    ['before window', lunch, '2026-10-10T09:59:00', false],
    [
      'cross-midnight, before midnight',
      { startTime: '22:00', endTime: '02:00' },
      '2026-10-10T23:30:00',
      true,
    ],
    [
      'cross-midnight, after midnight belongs to yesterday',
      { startTime: '22:00', endTime: '02:00', daysOfWeek: [5] }, // Friday only
      '2026-10-10T01:00:00', // Saturday 2026-10-10
      true,
    ],
    [
      'cross-midnight, wrong previous day',
      { startTime: '22:00', endTime: '02:00', daysOfWeek: [5] },
      '2026-10-11T01:00:00', // Sunday — previous day Saturday, not Friday
      false,
    ],
    [
      'cross-midnight, middle of the night gap',
      { startTime: '22:00', endTime: '02:00' },
      '2026-10-10T03:00:00',
      false,
    ],
    [
      'weekday filter applies to the start day',
      { ...lunch, daysOfWeek: [6] }, // Saturday
      '2026-10-10T11:00:00', // Saturday
      true,
    ],
    [
      'weekday filter rejects other days',
      { ...lunch, daysOfWeek: [6] },
      '2026-10-11T11:00:00', // Sunday
      false,
    ],
    ['inactive window never matches', { ...lunch, isActive: false }, '2026-10-10T11:00:00', false],
    [
      'validFrom not reached yet',
      { ...lunch, validFrom: '2026-11-01T00:00:00' },
      '2026-10-10T11:00:00',
      false,
    ],
    [
      'validTo elapsed',
      { ...lunch, validTo: '2026-10-01T00:00:00' },
      '2026-10-10T11:00:00',
      false,
    ],
  ];
  it.each(cases)('%s', (_name, window, iso, expected) => {
    expect(isWithinSellingWindow(local(iso), window)).toBe(expected);
  });
});

describe('evaluateAvailability', () => {
  const base = { status: 'active', sellOnline: true };
  const scenarios: [string, Parameters<typeof evaluateAvailability>[0], boolean, string[]][] = [
    ['everything on', { ...base }, true, []],
    ['draft status', { ...base, status: 'draft' }, false, ['not-active']],
    ['archived status', { ...base, status: 'archived' }, false, ['not-active']],
    ['sellOnline off', { ...base, sellOnline: false }, false, ['not-sell-online']],
    [
      'indefinite tạm hết',
      { ...base, locationState: { selling: false } },
      false,
      ['temporarily-unavailable'],
    ],
    [
      'tạm hết đến một giờ — still inside',
      {
        ...base,
        nowLocal: local('2026-10-10T20:00:00'),
        locationState: { selling: false, outOfStockUntil: '2026-10-11T04:00:00' },
      },
      false,
      ['temporarily-unavailable'],
    ],
    [
      'tạm hết đến một giờ — elapsed, back on sale',
      {
        ...base,
        nowLocal: local('2026-10-10T20:00:00'),
        locationState: { selling: false, outOfStockUntil: '2026-10-10T18:00:00' },
      },
      true,
      [],
    ],
    [
      'outside selling window',
      {
        ...base,
        nowLocal: local('2026-10-10T15:00:00'),
        windows: [{ startTime: '10:30', endTime: '14:00' }],
      },
      false,
      ['outside-window'],
    ],
    [
      'inside one of several windows (union)',
      {
        ...base,
        nowLocal: local('2026-10-10T11:00:00'),
        windows: [
          { startTime: '06:00', endTime: '09:00' },
          { startTime: '10:30', endTime: '14:00' },
        ],
      },
      true,
      [],
    ],
    [
      'combo hết khi item bắt buộc hết',
      { ...base, allRequiredComponentsAvailable: false },
      false,
      ['component-unavailable'],
    ],
    [
      'several reasons at once',
      { status: 'draft', sellOnline: false },
      false,
      ['not-active', 'not-sell-online'],
    ],
  ];
  it.each(scenarios)('%s', (_name, input, purchasable, reasons) => {
    const verdict = evaluateAvailability(input);
    expect(verdict.purchasable).toBe(purchasable);
    expect(verdict.reasons).toEqual(reasons);
  });

  it('reports resumesAt for a timed tạm hết', () => {
    const verdict = evaluateAvailability({
      ...base,
      nowLocal: local('2026-10-10T20:00:00'),
      locationState: { selling: false, outOfStockUntil: '2026-10-11T04:00:00' },
    });
    expect(verdict.resumesAt?.getTime()).toBe(Date.parse('2026-10-11T04:00:00'));
  });
});

describe('instantAtLocal / localPartsInZone', () => {
  it('converts a branch-local wall time to the correct UTC instant', () => {
    // Asia/Ho_Chi_Minh is UTC+7 — 04:00 local is 21:00Z the previous UTC day.
    const at = instantAtLocal('2026-10-11T04:00:00', 'Asia/Ho_Chi_Minh');
    expect(at.toISOString()).toBe('2026-10-10T21:00:00.000Z');
  });

  it('renders instants in the target zone, not the host zone', () => {
    expect(localPartsInZone(new Date('2026-10-10T21:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe(
      '2026-10-11T04:00:00',
    );
    expect(localPartsInZone(new Date('2026-10-10T21:00:00Z'), 'America/New_York')).toBe(
      '2026-10-10T17:00:00',
    );
  });
});

describe('nextBusinessDayCutoff', () => {
  const TZ = 'Asia/Ho_Chi_Minh'; // UTC+7
  const cases: [string, string, string][] = [
    // Before the cutoff on the same branch-local day → today's cutoff.
    ['2026-10-09T20:00:00Z', '04:00', '2026-10-09T21:00:00Z'], // local Oct10 03:00 → Oct10 04:00
    // After the cutoff → next branch-local day.
    ['2026-10-10T02:00:00Z', '04:00', '2026-10-10T21:00:00Z'], // local Oct10 09:00 → Oct11 04:00
    ['2026-10-10T21:00:00Z', '04:00', '2026-10-11T21:00:00Z'], // exactly at cutoff → next day
    // A same-day "đến giờ" toggle picked by staff (mockup: "14:00 hôm nay").
    ['2026-10-10T03:30:00Z', '14:00', '2026-10-10T07:00:00Z'], // local 10:30 → 14:00 today
    ['2026-10-10T10:00:00Z', '14:00', '2026-10-11T07:00:00Z'], // local 17:00 → 14:00 tomorrow
  ];
  it.each(cases)('now %s + cutoff %s → %s', (nowIso, cutoff, expectedIso) => {
    expect(nextBusinessDayCutoff(new Date(nowIso), cutoff, TZ).toISOString()).toBe(
      `${expectedIso.slice(0, 19)}.000Z`,
    );
  });

  it('honours a different branch timezone', () => {
    // New York is UTC-4 in October: 04:00 local = 08:00Z.
    expect(
      nextBusinessDayCutoff(new Date('2026-10-10T05:00:00Z'), '04:00', 'America/New_York').toISOString(),
    ).toBe('2026-10-10T08:00:00.000Z');
  });
});
