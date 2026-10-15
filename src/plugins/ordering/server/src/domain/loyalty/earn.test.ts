import { describe, expect, it } from 'vitest';

import { priceCart } from '../pricing/pipeline';
import type { TaxContext } from '../pricing/tax';
import { capDailyEarn, earnBase, earnPoints } from './earn';

const line = (over: Partial<Parameters<typeof earnBase>[0][number]> = {}) => ({
  quantity: 1,
  pricedQuantity: null,
  canceledQuantity: 0,
  baseAmount: 100_000,
  discountAmount: 0,
  ...over,
});

describe('earnBase', () => {
  it('sums base plus discount of live lines', () => {
    expect(earnBase([line({ baseAmount: 200_000, discountAmount: -20_000 }), line()])).toBe(280_000);
  });

  it('prorates a partly canceled line over its priced units', () => {
    expect(earnBase([line({ quantity: 4, canceledQuantity: 1, baseAmount: 400_000 })])).toBe(300_000);
    // Edited line: 3 of 4 units were priced (one was gone at the edit), one more canceled since.
    expect(
      earnBase([line({ quantity: 4, pricedQuantity: 3, canceledQuantity: 2, baseAmount: 300_000 })]),
    ).toBe(200_000);
  });

  it('ignores fully canceled lines and takes gift-card money off first, never below zero', () => {
    expect(earnBase([line({ quantity: 2, canceledQuantity: 2 }), line()])).toBe(100_000);
    expect(earnBase([line()], 30_000)).toBe(70_000);
    expect(earnBase([line()], 500_000)).toBe(0);
  });

  it('excludes fees, rounding and outside tax by construction (priced cart)', () => {
    const TAX: TaxContext = {
      enabled: true,
      pricesIncludeTax: false,
      defaultCategory: 'standard',
      categories: { standard: { label: 'VAT', rates: [{ ratePercent: 8, validFrom: '2020-01-01' }] } },
    };
    const priced = priceCart({
      currency: 'VND',
      at: '2026-10-15T00:00:00.000Z',
      tax: TAX,
      fulfillmentAmount: 20_000,
      cashRounding: { multiple: 1_000 },
      lines: [{ key: 'a', quantity: 2, unitAmount: 55_555, optionAmount: 0 }],
      adjustments: [
        { kind: 'discount', code: 'loyalty', label: 'Điểm', amount: -10_000, sourceRef: 'loyalty', priority: 9 },
        { kind: 'fee', code: 'service', label: 'Phí', amount: 15_000, sourceRef: 'fee:service', priority: 99 },
      ],
    });
    const lines = priced.lines.map((l) => ({ ...line(), ...l }));
    expect(priced.lines[0].lineTotalAmount).not.toBe(2 * 55_555 - 10_000);
    expect(earnBase(lines)).toBe(2 * 55_555 - 10_000);
  });
});

describe('earnPoints', () => {
  it('floors once: ×1.0 earns floor(base / earnPerAmount)', () => {
    expect(earnPoints({ base: 300_000, earnPerAmount: 10_000, multiplier: 100 })).toBe(30);
    expect(earnPoints({ base: 99_999, earnPerAmount: 10_000, multiplier: 100 })).toBe(9);
  });

  it('applies the tier multiplier before the single floor', () => {
    expect(earnPoints({ base: 99_999, earnPerAmount: 10_000, multiplier: 120 })).toBe(11);
    expect(earnPoints({ base: 300_000, earnPerAmount: 10_000, multiplier: 150 })).toBe(45);
  });

  it('earns nothing on a non-positive base or setting', () => {
    expect(earnPoints({ base: 0, earnPerAmount: 10_000, multiplier: 100 })).toBe(0);
    expect(earnPoints({ base: 5_000, earnPerAmount: 10_000, multiplier: 100 })).toBe(0);
    expect(earnPoints({ base: 10_000, earnPerAmount: 0, multiplier: 100 })).toBe(0);
  });
});

describe('capDailyEarn', () => {
  it('cuts at the daily room and drops the excess', () => {
    expect(capDailyEarn({ points: 500, earnedToday: 1_800, dailyCap: 2_000 })).toBe(200);
    expect(capDailyEarn({ points: 50, earnedToday: 1_800, dailyCap: 2_000 })).toBe(50);
    expect(capDailyEarn({ points: 50, earnedToday: 2_000, dailyCap: 2_000 })).toBe(0);
    expect(capDailyEarn({ points: 50, earnedToday: 2_500, dailyCap: 2_000 })).toBe(0);
  });
});
