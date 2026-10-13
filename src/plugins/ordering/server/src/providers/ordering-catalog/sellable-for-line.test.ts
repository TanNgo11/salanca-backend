import { describe, expect, it } from 'vitest';

import type { Sellable } from '../../contracts';
import { sellableForLine } from './adapter';

const sellable = (variants: Array<{ ref: string; isDefault?: boolean; price?: number | null }>) =>
  ({
    ref: { uid: 'tra' },
    listPrice: { amount: 45000, currency: 'VND' },
    metadata: { catalog: { variants } },
  }) as unknown as Sellable;

describe('sellableForLine', () => {
  it('hands the product type the chosen variant price as the list price', () => {
    const line = sellableForLine(
      sellable([
        { ref: 'nho', isDefault: true, price: 30000 },
        { ref: 'lon', price: 52000 },
      ]),
      'lon',
    );
    expect(line.listPrice).toEqual({ amount: 52000, currency: 'VND' });
  });

  it('keeps the same object when the price does not change', () => {
    const base = sellable([{ ref: 'nho', isDefault: true, price: 45000 }]);
    expect(sellableForLine(base, undefined)).toBe(base);
  });

  it('falls back to the list price for adapters without variant prices', () => {
    const base = { ref: { uid: 'x' }, listPrice: { amount: 10000, currency: 'VND' } } as unknown as Sellable;
    expect(sellableForLine(base, 'any').listPrice.amount).toBe(10000);
  });
});
