import { describe, expect, it } from 'vitest';

import type { Sellable } from '../contracts';
import {
  catalogDailyRefs,
  dailyStockKey,
  receiveBusinessDate,
  stockTargetsForLine,
  sumStockTargets,
} from './daily-stock-lines';

const sellable = (overrides: Partial<Sellable> = {}): Sellable =>
  ({
    ref: { uid: 'bun-bo' },
    options: [],
    ...overrides,
  }) as Sellable;

describe('stockTargetsForLine', () => {
  it('uses the catalog document id, the variant, and strips mod: from a topping', () => {
    const targets = stockTargetsForLine({
      sellableUid: 'prod-uid',
      sourceDocumentId: 'prod-doc',
      variantUid: 'var-doc',
      quantity: 2,
      selected: [
        { optionUid: 'mod:topping', quantity: 3 },
        { optionUid: 'lon', quantity: 1 },
      ],
    });
    expect(targets).toEqual([
      { entityType: 'product', entityDocumentId: 'prod-doc', quantity: 2, sellableUid: 'prod-uid' },
      {
        entityType: 'variant',
        entityDocumentId: 'var-doc',
        quantity: 2,
        sellableUid: 'prod-uid',
        variantUid: 'var-doc',
      },
      {
        entityType: 'modifier',
        entityDocumentId: 'topping',
        quantity: 6,
        sellableUid: 'prod-uid',
        variantUid: 'var-doc',
        modifierUid: 'mod:topping',
      },
      {
        entityType: 'modifier',
        entityDocumentId: 'lon',
        quantity: 2,
        sellableUid: 'prod-uid',
        variantUid: 'var-doc',
        modifierUid: 'lon',
      },
    ]);
  });

  it('falls back to the sellable uid and skips a non-positive line or option', () => {
    expect(stockTargetsForLine({ sellableUid: 'bun-bo', quantity: 0 })).toEqual([]);
    expect(
      stockTargetsForLine({
        sellableUid: 'bun-bo',
        quantity: 1,
        selected: [{ optionUid: 'lon', quantity: 0 }],
      }).map((target) => target.entityType),
    ).toEqual(['product']);
  });

  it('sums portions of the same entity and keeps the first display ids', () => {
    const [product] = sumStockTargets([
      ...stockTargetsForLine({ sellableUid: 'bun-bo', quantity: 1 }),
      ...stockTargetsForLine({ sellableUid: 'bun-bo', quantity: 2 }),
    ]);
    expect(product).toMatchObject({ entityDocumentId: 'bun-bo', quantity: 3, sellableUid: 'bun-bo' });
    expect(dailyStockKey('product', 'bun-bo')).toBe('product\u0000bun-bo');
  });
});

describe('receiveBusinessDate', () => {
  const zone = 'Asia/Ho_Chi_Minh';

  it('puts 03:59 on the previous business day and 04:00 on the new one', () => {
    expect(
      receiveBusinessDate({
        placedAt: new Date('2026-10-13T20:59:00.000Z'),
        timezone: zone,
        cutoff: '04:00',
      }),
    ).toBe('2026-10-13');
    expect(
      receiveBusinessDate({
        placedAt: new Date('2026-10-13T21:00:00.000Z'),
        timezone: zone,
        cutoff: '04:00',
      }),
    ).toBe('2026-10-14');
  });

  it('charges a scheduled slot to the slot date, not the placement date', () => {
    expect(
      receiveBusinessDate({
        placedAt: new Date('2026-10-20T03:00:00.000Z'),
        timezone: zone,
        cutoff: '04:00',
        slotStartsAt: '2026-10-24T05:00:00.000Z',
      }),
    ).toBe('2026-10-24');
  });
});

describe('catalogDailyRefs', () => {
  it('reads the product document, variant refs, and modifier document ids', () => {
    const refs = catalogDailyRefs(
      sellable({
        ref: { uid: 'prod-1', sourceDocumentId: 'prod-1' },
        metadata: { catalog: { variants: [{ ref: 'v1' }, { ref: '' }, { title: 'skip' }] } },
        options: [
          {
            uid: 'mg:g1',
            name: 'Topping',
            required: false,
            defaultOptionUids: [],
            minQuantity: 0,
            maxQuantity: 1,
            stepQuantity: 1,
            freeQuantity: 0,
            options: [
              { uid: 'mod:m1', name: 'Chả', unitPriceDelta: { amount: 1, currency: 'VND' }, isActive: true },
            ],
          },
        ],
      }),
    );
    expect(refs).toEqual([
      { entityType: 'product', entityDocumentId: 'prod-1' },
      { entityType: 'variant', entityDocumentId: 'v1' },
      { entityType: 'modifier', entityDocumentId: 'm1' },
    ]);
  });
});
