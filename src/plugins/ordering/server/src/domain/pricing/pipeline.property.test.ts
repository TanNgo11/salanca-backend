import { describe, expect, it } from 'vitest';

import { isOrderingError } from '../errors';
import { priceCart, type PricingAdjustmentInput, type PricingInput } from './pipeline';
import type { TaxContext } from './tax';

/** Deterministic PRNG so the run reproduces exactly. */
const mulberry32 = (seed: number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const TAX_OFF: TaxContext = {
  enabled: false,
  pricesIncludeTax: true,
  defaultCategory: 'standard',
  categories: {},
};

const VAT8 = (inclusive: boolean): TaxContext => ({
  enabled: true,
  pricesIncludeTax: inclusive,
  defaultCategory: 'standard',
  categories: {
    standard: { label: 'VAT', rates: [{ ratePercent: 8, validFrom: '2020-01-01' }] },
  },
});

const randomCart = (random: () => number, index: number): PricingInput => {
  const pick = (maxExclusive: number) => Math.floor(random() * maxExclusive);
  const lineCount = 1 + pick(10);
  const lines = Array.from({ length: lineCount }, (_, lineIndex) => ({
    key: `l${index}-${lineIndex}`,
    quantity: 1 + pick(5),
    unitAmount: pick(1001) * 500,
    optionAmount: pick(101) * 500,
  }));
  const subtotal = lines.reduce(
    (sum, line) => sum + (line.unitAmount + line.optionAmount) * line.quantity,
    0,
  );

  const adjustments: PricingAdjustmentInput[] = [];
  let discountBudget = subtotal;
  const adjustmentCount = pick(4);
  for (let i = 0; i < adjustmentCount; i += 1) {
    const push = (adjustment: PricingAdjustmentInput) => {
      adjustment.priority = pick(3);
      adjustments.push(adjustment);
    };
    switch (pick(4)) {
      case 0: {
        const percent = 1 + pick(50);
        // Percent discounts still consume the discount budget so the cart stays valid.
        const amount = Math.round((subtotal * percent) / 100);
        if (amount > discountBudget) break;
        discountBudget -= amount;
        push({ kind: 'discount', code: `pd${i}`, label: 'Percent discount', percent });
        break;
      }
      case 1:
        push({ kind: 'fee', code: `pf${i}`, label: 'Percent fee', percent: 1 + pick(20) });
        break;
      case 2: {
        const amount = pick(discountBudget + 1);
        discountBudget -= amount;
        push({ kind: 'discount', code: `d${i}`, label: 'Discount', amount: -amount });
        break;
      }
      default:
        push({ kind: 'fee', code: `f${i}`, label: 'Fee', amount: pick(101) * 500 });
    }
  }

  const taxMode = pick(3);
  const tax = taxMode === 0 ? TAX_OFF : VAT8(taxMode === 1);
  return {
    currency: 'VND',
    lines,
    adjustments,
    fulfillmentAmount: pick(7) * 5000,
    tax,
    at: '2026-10-10T12:00:00.000Z',
    // Cash rounding only where the total can land on the multiple (tax off or inclusive).
    cashRounding: taxMode === 2 || random() < 0.5 ? null : { multiple: 1000 },
  };
};

const assertAllSafeIntegers = (value: unknown, path: string): void => {
  if (typeof value === 'number') {
    expect(Number.isSafeInteger(value), `${path} must be a safe integer`).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => assertAllSafeIntegers(item, `${path}[${i}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      assertAllSafeIntegers(item, `${path}.${key}`);
    }
  }
};

describe('priceCart property checks (seeded)', () => {
  const random = mulberry32(20261010);
  const carts = Array.from({ length: 1000 }, (_, index) => randomCart(random, index));

  it('keeps every invariant across 1000 random carts', { timeout: 30000 }, () => {
    for (const [index, cart] of carts.entries()) {
      let first: ReturnType<typeof priceCart>;
      try {
        first = priceCart(cart);
      } catch (error) {
        // Bounded discounts should never trip validation; surface the failing cart index.
        throw new Error(`cart ${index} threw: ${(error as Error).message}`);
      }
      for (const adjustment of first.adjustments) {
        expect(
          adjustment.allocations.reduce((sum, a) => sum + a.amount, 0),
          `cart ${index} adjustment ${adjustment.code} allocations`,
        ).toBe(adjustment.amount);
      }
      expect(
        first.lines.reduce((sum, line) => sum + line.lineTotalAmount, 0) +
          first.totals.fulfillmentTotal,
        `cart ${index} grand total`,
      ).toBe(first.totals.grandTotal);
      assertAllSafeIntegers(first.lines, `cart ${index}.lines`);
      assertAllSafeIntegers(first.totals, `cart ${index}.totals`);

      const second = priceCart(cart);
      expect(second.cartHash).toBe(first.cartHash);
    }
  });

  it('is deterministic across independent runs of the same cart', () => {
    const cart = carts[0];
    expect(priceCart(cart)).toEqual(priceCart(cart));
  });
});

describe('priceCart — unexpected OrderingError surface', () => {
  it('only throws OrderingError codes', () => {
    try {
      priceCart({ ...cartsInput(), adjustments: [{ kind: 'fee', code: 'x', label: 'y' }] });
    } catch (error) {
      expect(isOrderingError(error)).toBe(true);
    }
  });
});

const cartsInput = (): PricingInput => ({
  currency: 'VND',
  lines: [{ key: 'a', quantity: 1, unitAmount: 1, optionAmount: 0 }],
  adjustments: [],
  fulfillmentAmount: 0,
  tax: TAX_OFF,
  at: '2026-10-10T12:00:00.000Z',
});
