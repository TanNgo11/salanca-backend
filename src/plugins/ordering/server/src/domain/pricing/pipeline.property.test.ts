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

const targetedCart = (random: () => number, index: number): PricingInput => {
  const pick = (maxExclusive: number) => Math.floor(random() * maxExclusive);
  const lineCount = 1 + pick(6);
  const lines = Array.from({ length: lineCount }, (_, lineIndex) => ({
    key: `t${index}-${lineIndex}`,
    quantity: 1 + pick(3),
    unitAmount: (1 + pick(40)) * 1000,
    optionAmount: pick(5) * 1000,
  }));
  const bases = lines.map((line) => (line.unitAmount + line.optionAmount) * line.quantity);
  const adjustments: PricingAdjustmentInput[] = [];
  // Disjoint line groups so stacked line discounts cannot push one line below zero.
  const claimed = new Set<number>();
  const groupCount = pick(lineCount + 1);
  for (let group = 0; group < groupCount; group += 1) {
    const free = bases.map((_, lineIndex) => lineIndex).filter((lineIndex) => !claimed.has(lineIndex));
    if (free.length === 0) break;
    const take = 1 + pick(free.length);
    const lineIndexes = free.slice(0, take);
    for (const lineIndex of lineIndexes) claimed.add(lineIndex);
    const base = lineIndexes.reduce((sum, lineIndex) => sum + bases[lineIndex], 0);
    if (base === 0) continue;
    if (random() < 0.5) {
      const percent = 1 + pick(100);
      adjustments.push({
        kind: 'discount',
        code: `lp${group}`,
        label: 'Line percent',
        percent,
        target: { kind: 'lines', lineIndexes },
      });
    } else {
      adjustments.push({
        kind: 'discount',
        code: `la${group}`,
        label: 'Line amount',
        amount: -pick(base + 1),
        target: { kind: 'lines', lineIndexes },
      });
    }
  }
  const fulfillmentAmount = pick(8) * 5000;
  if (fulfillmentAmount > 0 && random() < 0.7) {
    if (random() < 0.5) {
      adjustments.push({
        kind: 'discount',
        code: 'ship-p',
        label: 'Ship percent',
        percent: 1 + pick(100),
        target: { kind: 'fulfillment' },
      });
    } else {
      adjustments.push({
        kind: 'discount',
        code: 'ship-a',
        label: 'Ship amount',
        amount: -pick(fulfillmentAmount + 1),
        target: { kind: 'fulfillment' },
      });
    }
  }
  if (random() < 0.4) {
    adjustments.push({ kind: 'fee', code: 'pack', label: 'Pack', amount: pick(6) * 1000 });
  }
  return {
    currency: 'VND',
    lines,
    adjustments,
    fulfillmentAmount,
    tax: TAX_OFF,
    at: '2026-10-10T12:00:00.000Z',
    cashRounding: random() < 0.3 ? { multiple: 1000 } : null,
  };
};

describe('priceCart target property checks (seeded)', () => {
  const random = mulberry32(20261013);
  const carts = Array.from({ length: 200 }, (_, index) => targetedCart(random, index));

  it('keeps totals and allocations when targets are random', () => {
    for (const [index, cart] of carts.entries()) {
      const priced = priceCart(cart);
      const fulfillmentEffect = priced.adjustments
        .filter((adjustment) => adjustment.target.kind === 'fulfillment')
        .reduce((sum, adjustment) => sum + adjustment.amount, 0);
      expect(priced.totals.fulfillmentTotal, `cart ${index} fulfillment`).toBe(
        cart.fulfillmentAmount + fulfillmentEffect,
      );
      for (const adjustment of priced.adjustments) {
        const allocated = adjustment.allocations.reduce((sum, row) => sum + row.amount, 0);
        if (adjustment.target.kind === 'fulfillment') {
          expect(adjustment.allocations, `cart ${index} ${adjustment.code}`).toEqual([]);
        } else {
          expect(allocated, `cart ${index} ${adjustment.code}`).toBe(adjustment.amount);
        }
      }
      expect(
        priced.lines.reduce((sum, line) => sum + line.lineTotalAmount, 0) + priced.totals.fulfillmentTotal,
        `cart ${index} grand total`,
      ).toBe(priced.totals.grandTotal);
      for (const line of priced.lines) {
        expect(line.baseAmount + line.discountAmount).toBeGreaterThanOrEqual(0);
      }
      expect(priced.totals.fulfillmentTotal).toBeGreaterThanOrEqual(0);
      expect(priceCart(cart).cartHash).toBe(priced.cartHash);
    }
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
