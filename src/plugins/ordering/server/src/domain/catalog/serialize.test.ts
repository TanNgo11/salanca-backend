import { describe, expect, it } from 'vitest';

import type { Sellable } from '../../contracts';
import { serializeCategoryTree, serializeProduct } from './serialize';

const INTERNAL_KEYS = ['rank', 'metadata', 'availabilityInput', 'parentRef', 'isInternal', 'isActive'];

const walk = (value: unknown, visit: (key: string) => void): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      visit(key);
      walk(child, visit);
    }
  }
};

const fixtureSellable = (overrides: Partial<Sellable> = {}): Sellable => ({
  ref: { uid: 'prod-1', sourceDocumentId: 'prod-1' },
  productType: 'food',
  title: 'Bún bò Huế',
  description: 'Nước dùng đậm',
  imageUrl: 'https://cdn.example.com/bun-bo.jpg',
  variant: { uid: 'v1', sku: 'BB-STD', attributes: {} },
  listPrice: { amount: 65000, currency: 'VND' },
  requiresShipping: true,
  isVirtual: false,
  isDownloadable: false,
  isGiftCard: false,
  fulfillmentKinds: ['pickup', 'delivery'],
  options: [
    {
      uid: 'mg:g1',
      name: 'Topping',
      required: false,
      defaultOptionUids: ['mod:m1'],
      minQuantity: 0,
      maxQuantity: 3,
      stepQuantity: 1,
      freeQuantity: 0,
      options: [
        {
          uid: 'mod:m1',
          name: 'Chả cua',
          unitPriceDelta: { amount: 15000, currency: 'VND' },
          isActive: true,
        },
        {
          uid: 'mod:m2',
          name: 'Giò heo',
          unitPriceDelta: { amount: 25000, currency: 'VND' },
          isActive: false,
        },
      ],
    },
    {
      uid: 'slot:drink',
      name: 'Đồ uống',
      required: true,
      defaultOptionUids: [],
      minQuantity: 1,
      maxQuantity: Number.MAX_SAFE_INTEGER,
      stepQuantity: 1,
      freeQuantity: 0,
      options: [
        {
          uid: 'item:v9',
          name: 'Trà đá',
          unitPriceDelta: { amount: 0, currency: 'VND' },
          isActive: true,
        },
      ],
    },
  ],
  availability: {},
  categories: [
    { ref: 'c1', title: 'Món chính', path: ['c1'] },
    { ref: 'c2', title: 'Món Huế', path: ['c1', 'c2'] },
  ],
  isActive: true,
  purchasable: true,
  metadata: {
    availabilityInput: { status: 'active', sellOnline: true },
    catalog: {
      slug: 'bun-bo-hue',
      availability: { reasons: [] },
      variants: [
        { ref: 'v1', sku: 'BB-STD', title: 'Tô thường', isDefault: true, price: 65000, available: true },
        { ref: 'v2', title: 'Tô đặc biệt', isDefault: false, price: 85000, available: false },
      ],
    },
  },
  ...overrides,
});

describe('serializeProduct', () => {
  it('emits the storefront allowlist in the mockup shape', () => {
    const out = serializeProduct(fixtureSellable());
    expect(out.slug).toBe('bun-bo-hue');
    expect(out.name).toBe('Bún bò Huế');
    expect(out.price).toBe(65000);
    expect(out.categories).toEqual(['Món chính', 'Món Huế']);
    expect(out.available).toBe(true);
    expect(out.fulfillment).toEqual(['pickup', 'delivery']);

    const variants = out.variants as Record<string, unknown>[];
    expect(variants[0]).toMatchObject({ id: 'v1', name: 'Tô thường', price: 65000, default: true });
    expect(variants[0].available).toBeUndefined();
    expect(variants[1]).toMatchObject({ id: 'v2', price: 85000, available: false });

    const [topping, drink] = out.options as Record<string, unknown>[];
    expect(topping).toMatchObject({ id: 'mg:g1', group: 'Topping', min: 0, max: 3 });
    const choices = topping.choices as Record<string, unknown>[];
    expect(choices[0]).toMatchObject({ id: 'mod:m1', name: 'Chả cua', price: 15000, default: true });
    expect(choices[1]).toMatchObject({ id: 'mod:m2', price: 25000, available: false });
    expect(drink.max).toBeNull();
  });

  it('never leaks internal keys', () => {
    const out = serializeProduct(fixtureSellable({ purchasable: false }));
    const seen: string[] = [];
    walk(out, (key) => seen.push(key));
    for (const key of INTERNAL_KEYS) expect(seen).not.toContain(key);
  });

  it('surfaces reasons and resumesAt only when unavailable', () => {
    const out = serializeProduct(
      fixtureSellable({
        purchasable: false,
        metadata: {
          catalog: {
            slug: 'x',
            availability: { reasons: ['temporarily-unavailable'], resumesAt: '2026-10-10T14:00:00.000Z' },
            variants: [],
          },
        },
      }),
    );
    expect(out.available).toBe(false);
    expect(out.reasons).toEqual(['temporarily-unavailable']);
    expect(out.resumesAt).toBe('2026-10-10T14:00:00.000Z');
    expect(serializeProduct(fixtureSellable()).reasons).toBeUndefined();
  });

  it('marks a product sold out for the day without treating a sold-out variant as the product', () => {
    const view = {
      date: '2026-10-17',
      remainingByKey: new Map([
        ['product\u0000prod-1', 0],
        ['variant\u0000v2', 0],
        ['modifier\u0000m1', 2],
      ]),
    };
    const out = serializeProduct(fixtureSellable(), view);
    expect(out.available).toBe(false);
    expect(out.unavailableReason).toBe('sold-out-today');
    expect(out.dailyLimit).toEqual({ remaining: 0, date: '2026-10-17' });
    expect(out.reasons).toBeUndefined();

    const variantOnly = serializeProduct(fixtureSellable(), {
      date: '2026-10-17',
      remainingByKey: new Map([['variant\u0000v1', 0]]),
    });
    expect(variantOnly.available).toBe(true);
    expect(variantOnly.unavailableReason).toBeUndefined();
    const variants = variantOnly.variants as Record<string, unknown>[];
    expect(variants[0].available).toBe(false);
    expect(variants[0].dailyLimit).toEqual({ remaining: 0, date: '2026-10-17' });
    expect(variants[1].dailyLimit).toBeUndefined();

    const topping = serializeProduct(fixtureSellable(), {
      date: '2026-10-17',
      remainingByKey: new Map([['modifier\u0000m1', 0]]),
    });
    const choices = ((topping.options as Record<string, unknown>[])[0].choices) as Record<string, unknown>[];
    expect(choices[0]).toMatchObject({
      available: false,
      dailyLimit: { remaining: 0, date: '2026-10-17' },
    });
    expect(topping.available).toBe(true);
  });
});

describe('serializeCategoryTree', () => {
  const rows = [
    { ref: 'a', slug: 'mon-chinh', title: 'Món chính', parentRef: null, isActive: true },
    { ref: 'b', slug: 'mon-hue', title: 'Món Huế', parentRef: 'a', isActive: true },
    { ref: 'c', slug: 'noi-bo', title: 'Nội bộ', parentRef: 'a', isInternal: true },
    { ref: 'd', slug: 'off', title: 'Ẩn', parentRef: null, isActive: false },
    { ref: 'e', slug: 'off-child', title: 'Con của ẩn', parentRef: 'd', isActive: true },
  ];

  it('builds a nested tree and prunes inactive/internal subtrees', () => {
    const tree = serializeCategoryTree(rows);
    expect(tree).toHaveLength(1);
    const root = tree[0] as { name: string; children: Record<string, unknown>[] };
    expect(root.name).toBe('Món chính');
    expect(root.children).toHaveLength(1);
    expect((root.children[0] as { name: string }).name).toBe('Món Huế');
  });

  it('only emits public fields', () => {
    const seen: string[] = [];
    walk(serializeCategoryTree(rows), (key) => seen.push(key));
    for (const key of INTERNAL_KEYS) expect(seen).not.toContain(key);
    expect(seen).toContain('slug');
  });
});
