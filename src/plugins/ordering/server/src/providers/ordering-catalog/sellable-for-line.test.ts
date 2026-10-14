import { describe, expect, it } from 'vitest';

import type { Sellable } from '../../contracts';
import { sellableForLine } from './adapter';

const sellable = (
  variants: Array<{
    ref: string;
    sku?: string;
    title?: string;
    isDefault?: boolean;
    price?: number | null;
    available?: boolean;
  }>,
) =>
  ({
    ref: { uid: 'tra' },
    title: 'Trà',
    variant: { uid: variants.find((row) => row.isDefault)?.ref ?? variants[0]?.ref, sku: 'NHO', attributes: {} },
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

  it('applies the chosen variant: uid, sku, title and price', () => {
    const line = sellableForLine(
      sellable([
        { ref: 'nho', sku: 'NHO', title: 'Ly nhỏ', isDefault: true, price: 30000 },
        { ref: 'lon', sku: 'LON', title: 'Ly lớn', price: 52000 },
      ]),
      'lon',
    );
    expect(line.variant).toMatchObject({ uid: 'lon', sku: 'LON', title: 'Ly lớn' });
    expect(line.title).toBe('Trà · Ly lớn');
  });

  it('keeps the plain title when the chosen variant is the default one', () => {
    const line = sellableForLine(
      sellable([{ ref: 'nho', sku: 'NHO', title: 'Ly nhỏ', isDefault: true, price: 30000 }]),
      'nho',
    );
    expect(line.title).toBe('Trà');
    expect(line.variant?.sku).toBe('NHO');
  });

  it('rejects a variant that is not part of the product, with the line field', () => {
    expect(() => sellableForLine(sellable([{ ref: 'nho', isDefault: true, price: 30000 }]), 'ghost', 2)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR', details: { field: 'lines.2.variantUid', lineIndex: 2 } }),
    );
  });

  it('rejects a product with no variants at all when a variant is named', () => {
    expect(() => sellableForLine(sellable([]), 'ghost')).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  it('refuses a variant that is tạm hết', () => {
    expect(() =>
      sellableForLine(
        sellable([
          { ref: 'nho', isDefault: true, price: 30000 },
          { ref: 'lon', price: 52000, available: false },
        ]),
        'lon',
      ),
    ).toThrow(expect.objectContaining({ code: 'SELLABLE_UNAVAILABLE' }));
  });
});
