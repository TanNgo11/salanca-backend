import { describe, expect, it } from 'vitest';

import { type CatalogPriceRow, selectCatalogPrice } from './price-selection';

const row = (overrides: Partial<CatalogPriceRow> = {}): CatalogPriceRow => ({
  amount: 50000,
  currency: 'VND',
  ...overrides,
});

const at = new Date('2026-10-10T12:00:00Z');

describe('selectCatalogPrice', () => {
  it('returns the only base row', () => {
    const result = selectCatalogPrice([row()], { at });
    expect(result).toMatchObject({ amount: 50000, currency: 'VND', matchedRules: [] });
  });
  it('parses bigint amounts from the database', () => {
    const result = selectCatalogPrice([row({ amount: '65000' })], { at });
    expect(result?.amount).toBe(65000);
  });
  it('returns null for an empty list', () => {
    expect(selectCatalogPrice([], { at })).toBeNull();
  });
  it('drops rows outside the valid window', () => {
    const rows = [
      row({ amount: 100, validFrom: '2026-10-01', validTo: '2026-10-05' }),
      row({ amount: 200, validFrom: '2026-10-20' }),
      row({ amount: 300, validTo: '2026-10-01' }),
    ];
    expect(selectCatalogPrice(rows, { at })).toBeNull();
  });
  it('keeps rows whose window covers the instant', () => {
    const rows = [
      row({ amount: 55000, validFrom: '2026-10-01', validTo: '2026-10-31' }),
      row({ amount: 60000 }),
    ];
    const result = selectCatalogPrice(rows, { at });
    // Same specificity → higher minQuantity? both 1 → lowest amount wins deterministically.
    expect(result?.amount).toBe(55000);
  });
  it('a location rule only matches that location', () => {
    const rows = [row({ amount: 70000, rules: { locationRef: 'Q1' } }), row({ amount: 65000 })];
    expect(selectCatalogPrice(rows, { at, locationRef: 'Q1' })?.amount).toBe(70000);
    expect(selectCatalogPrice(rows, { at, locationRef: 'Q3' })?.amount).toBe(65000);
    expect(selectCatalogPrice(rows, { at })?.amount).toBe(65000);
  });
  it('more matched rule keys beats priority', () => {
    const rows = [
      row({ amount: 90000, rules: { channel: 'web' }, priority: 100 }),
      row({ amount: 80000, rules: { locationRef: 'Q1', channel: 'web' } }),
    ];
    const result = selectCatalogPrice(rows, { at, locationRef: 'Q1', channel: 'web' });
    expect(result?.amount).toBe(80000);
    expect(result?.matchedRules).toEqual(['locationRef', 'channel']);
  });
  it('priority breaks equal specificity', () => {
    const rows = [row({ amount: 100, priority: 1 }), row({ amount: 200, priority: 5 })];
    expect(selectCatalogPrice(rows, { at })?.amount).toBe(200);
  });
  it('higher minQuantity is more specific when quantity qualifies', () => {
    const rows = [row({ amount: 100 }), row({ amount: 90, minQuantity: 5 })];
    expect(selectCatalogPrice(rows, { at, quantity: 10 })?.amount).toBe(90);
    expect(selectCatalogPrice(rows, { at, quantity: 2 })?.amount).toBe(100);
  });
  it('a rule the context cannot satisfy disqualifies the row', () => {
    const rows = [row({ amount: 100, rules: { customerGroup: 'vip' } }), row({ amount: 200 })];
    expect(selectCatalogPrice(rows, { at })?.amount).toBe(200);
  });
  it('exposes compareAtAmount when set', () => {
    const result = selectCatalogPrice([row({ amount: 45000, compareAtAmount: '59000' })], { at });
    expect(result?.compareAtAmount).toBe(59000);
  });
});
