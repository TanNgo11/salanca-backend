import { describe, expect, it } from 'vitest';

import { resolveTaxRate, taxForLineAmount, type TaxContext } from './tax';

const ctx = (overrides: Partial<TaxContext> = {}): TaxContext => ({
  enabled: true,
  pricesIncludeTax: true,
  defaultCategory: 'standard',
  categories: {
    standard: {
      label: 'VAT',
      rates: [{ ratePercent: 8, validFrom: '2020-01-01' }],
    },
    reduced: {
      label: 'Reduced VAT',
      rates: [
        { ratePercent: 5, validFrom: '2020-01-01', validTo: '2026-01-01' },
        { ratePercent: 7, validFrom: '2026-01-01' },
      ],
    },
  },
  ...overrides,
});

describe('resolveTaxRate', () => {
  it('returns null when tax is disabled', () => {
    expect(resolveTaxRate(ctx({ enabled: false }), undefined, '2026-10-10')).toBeNull();
  });

  it('uses the default category when the line has no group ref', () => {
    expect(resolveTaxRate(ctx(), undefined, '2026-10-10')).toEqual({
      category: 'standard',
      ratePercent: 8,
    });
  });

  it('honours the line tax group ref and rate validity windows', () => {
    expect(resolveTaxRate(ctx(), 'reduced', '2025-06-01')).toEqual({
      category: 'reduced',
      ratePercent: 5,
    });
    expect(resolveTaxRate(ctx(), 'reduced', '2026-06-01')).toEqual({
      category: 'reduced',
      ratePercent: 7,
    });
    // validFrom <= at < validTo: boundary instants switch rate.
    expect(resolveTaxRate(ctx(), 'reduced', '2026-01-01')).toEqual({
      category: 'reduced',
      ratePercent: 7,
    });
  });

  it('returns null for an unknown category or no valid rate', () => {
    expect(resolveTaxRate(ctx(), 'ghost', '2026-10-10')).toBeNull();
    expect(resolveTaxRate(ctx(), 'reduced', '2019-01-01')).toBeNull();
  });
});

describe('taxForLineAmount', () => {
  it('extracts inclusive tax: 115227 at 8% → 8535', () => {
    expect(taxForLineAmount(115227, 8, true)).toBe(8535);
  });

  it('adds exclusive tax: 115227 at 8% → 9218', () => {
    expect(taxForLineAmount(115227, 8, false)).toBe(9218);
  });

  it('rounds half away from zero', () => {
    expect(taxForLineAmount(39886, 8, true)).toBe(2955); // 2954.52 → 2955
    expect(taxForLineAmount(100, 10, false)).toBe(10);
  });

  it('handles a fractional rate', () => {
    expect(taxForLineAmount(1000, 8.5, false)).toBe(85);
  });
});
