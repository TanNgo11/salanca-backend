import { describe, expect, it } from 'vitest';

import { isOrderingError } from '../errors';
import { priceCart, type PricingInput } from './pipeline';
import type { TaxContext } from './tax';

const TAX_OFF: TaxContext = {
  enabled: false,
  pricesIncludeTax: true,
  defaultCategory: 'standard',
  categories: {},
};

const vat8 = (inclusive: boolean): TaxContext => ({
  enabled: true,
  pricesIncludeTax: inclusive,
  defaultCategory: 'standard',
  categories: {
    standard: { label: 'VAT', rates: [{ ratePercent: 8, validFrom: '2020-01-01' }] },
  },
});

const AT = '2026-10-10T12:00:00.000Z';

/** The worked example from the O1 pricing mockup. */
const mockupInput = (overrides: Partial<PricingInput> = {}): PricingInput => ({
  currency: 'VND',
  lines: [
    { key: 'bun-bo', quantity: 2, unitAmount: 65000, optionAmount: 0 },
    { key: 'tra-dao', quantity: 1, unitAmount: 45000, optionAmount: 0 },
    { key: 'goi-cuon', quantity: 3, unitAmount: 15000, optionAmount: 0 },
  ],
  adjustments: [{ kind: 'discount', code: 'mockup', label: 'Giảm mẫu', amount: -25000 }],
  fulfillmentAmount: 0,
  tax: TAX_OFF,
  at: AT,
  ...overrides,
});

describe('priceCart — mockup example', () => {
  it('prices the mockup cart without tax', () => {
    const result = priceCart(mockupInput());
    expect(result.totals.subtotal).toBe(220000);
    expect(result.adjustments[0].allocations.map((a) => a.amount)).toEqual([
      -14773, -5114, -5113,
    ]);
    expect(
      result.lines.map(
        (line) => line.baseAmount + line.discountAmount + line.feeAmount + line.roundingDelta,
      ),
    ).toEqual([115227, 39886, 39887]);
    expect(result.lines.map((line) => line.lineTotalAmount)).toEqual([115227, 39886, 39887]);
    expect(result.totals.adjustmentTotal).toBe(-25000);
    expect(result.totals.taxTotal).toBe(0);
    expect(result.totals.grandTotal).toBe(195000);
    expect(result.cartHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps the grand total when VAT 8% is inclusive', () => {
    const result = priceCart(mockupInput({ tax: vat8(true) }));
    expect(result.lines.map((line) => line.taxAmount)).toEqual([8535, 2955, 2955]);
    expect(result.totals.taxTotal).toBe(14445);
    expect(result.lines.map((line) => line.lineTotalAmount)).toEqual([115227, 39886, 39887]);
    expect(result.totals.grandTotal).toBe(195000);
    expect(result.lines[0].taxSnapshot).toEqual({
      category: 'standard',
      ratePercent: 8,
      inclusive: true,
    });
  });

  it('adds VAT 8% on top when exclusive', () => {
    const result = priceCart(mockupInput({ tax: vat8(false) }));
    // Independent arithmetic: round(net * 0.08) per line.
    const nets = [115227, 39886, 39887];
    const taxes = nets.map((net) => Math.round(net * 0.08));
    expect(taxes).toEqual([9218, 3191, 3191]);
    expect(result.lines.map((line) => line.taxAmount)).toEqual(taxes);
    expect(result.totals.taxTotal).toBe(15600);
    expect(result.totals.grandTotal).toBe(195000 + taxes.reduce((sum, tax) => sum + tax, 0));
    expect(result.totals.grandTotal).toBe(210600);
  });
});

describe('priceCart — lines and adjustments', () => {
  it('prices a single line with no adjustments', () => {
    const result = priceCart(
      mockupInput({
        lines: [{ key: 'a', quantity: 2, unitAmount: 10000, optionAmount: 500 }],
        adjustments: [],
      }),
    );
    expect(result.lines[0].baseAmount).toBe(21000);
    expect(result.totals).toEqual({
      subtotal: 21000,
      adjustmentTotal: 0,
      fulfillmentTotal: 0,
      taxTotal: 0,
      grandTotal: 21000,
    });
  });

  it('prices ten lines', () => {
    const result = priceCart(
      mockupInput({
        lines: Array.from({ length: 10 }, (_, index) => ({
          key: `l${index}`,
          quantity: 1,
          unitAmount: (index + 1) * 1000,
          optionAmount: 0,
        })),
        adjustments: [],
      }),
    );
    expect(result.totals.subtotal).toBe(55000);
    expect(result.totals.grandTotal).toBe(55000);
  });

  it('resolves a percent discount against the subtotal', () => {
    const result = priceCart(
      mockupInput({
        adjustments: [{ kind: 'discount', code: 'p10', label: 'Giảm 10%', percent: 10 }],
      }),
    );
    expect(result.adjustments[0].amount).toBe(-22000);
    expect(result.totals.grandTotal).toBe(198000);
  });

  it('resolves a percent fee against the subtotal', () => {
    const result = priceCart(
      mockupInput({
        adjustments: [{ kind: 'fee', code: 'svc', label: 'Phí dịch vụ', percent: 5 }],
      }),
    );
    expect(result.adjustments[0].amount).toBe(11000);
    expect(result.totals.grandTotal).toBe(231000);
  });

  it('applies a fixed fee', () => {
    const result = priceCart(
      mockupInput({
        adjustments: [{ kind: 'fee', code: 'pack', label: 'Phí đóng gói', amount: 15000 }],
      }),
    );
    expect(result.totals.adjustmentTotal).toBe(15000);
    expect(result.totals.grandTotal).toBe(235000);
    expect(result.lines.reduce((sum, line) => sum + line.feeAmount, 0)).toBe(15000);
  });

  it('orders adjustments by priority then input order', () => {
    const result = priceCart(
      mockupInput({
        adjustments: [
          { kind: 'discount', code: 'late', label: 'Sau', amount: -1000, priority: 5 },
          { kind: 'fee', code: 'early', label: 'Trước', amount: 2000, priority: 1 },
          { kind: 'discount', code: 'also-early', label: 'Cùng sớm', amount: -500, priority: 1 },
        ],
      }),
    );
    expect(result.adjustments.map((a) => a.code)).toEqual(['early', 'also-early', 'late']);
    expect(result.lines[0].allocations.map((a) => a.adjustmentIndex)).toEqual([0, 1, 2]);
  });

  it('gives a zero-price line a zero discount allocation', () => {
    const result = priceCart(
      mockupInput({
        lines: [
          { key: 'paid', quantity: 1, unitAmount: 10000, optionAmount: 0 },
          { key: 'free', quantity: 1, unitAmount: 0, optionAmount: 0 },
        ],
        adjustments: [{ kind: 'discount', code: 'd', label: 'Giảm', amount: -3000 }],
      }),
    );
    const free = result.lines[1];
    expect(free.discountAmount).toBe(0);
    expect(free.allocations).toEqual([{ adjustmentIndex: 0, weight: 0, amount: 0 }]);
    expect(result.lines[0].discountAmount).toBe(-3000);
  });

  it('splits a fee evenly when every line is zero', () => {
    const result = priceCart(
      mockupInput({
        lines: [
          { key: 'a', quantity: 1, unitAmount: 0, optionAmount: 0 },
          { key: 'b', quantity: 1, unitAmount: 0, optionAmount: 0 },
          { key: 'c', quantity: 1, unitAmount: 0, optionAmount: 0 },
        ],
        adjustments: [{ kind: 'fee', code: 'svc', label: 'Phí', amount: 10 }],
      }),
    );
    expect(result.lines.map((line) => line.feeAmount)).toEqual([4, 3, 3]);
    expect(result.totals.grandTotal).toBe(10);
  });

  it('allocations always sum back to the adjustment amount', () => {
    const result = priceCart(
      mockupInput({
        adjustments: [
          { kind: 'discount', code: 'd', label: 'Giảm', amount: -777 },
          { kind: 'fee', code: 'f', label: 'Phí', amount: 333 },
          { kind: 'rounding', code: 'r', label: 'Làm tròn', amount: -7 },
        ],
      }),
    );
    for (const adjustment of result.adjustments) {
      expect(adjustment.allocations.reduce((sum, a) => sum + a.amount, 0)).toBe(adjustment.amount);
    }
  });

  it('accepts an input rounding adjustment of any sign', () => {
    const result = priceCart(
      mockupInput({
        adjustments: [{ kind: 'rounding', code: 'r', label: 'Làm tròn', amount: -321 }],
      }),
    );
    expect(result.totals.grandTotal).toBe(219679);
  });

  it('includes the fulfillment amount in the grand total', () => {
    const result = priceCart(mockupInput({ fulfillmentAmount: 20000 }));
    expect(result.totals.fulfillmentTotal).toBe(20000);
    expect(result.totals.grandTotal).toBe(215000);
  });
});

describe('priceCart — cash rounding', () => {
  it('adds +500 to land 195500 on the 1000 multiple', () => {
    const result = priceCart(
      mockupInput({
        adjustments: [{ kind: 'discount', code: 'd', label: 'Giảm', amount: -24500 }],
        cashRounding: { multiple: 1000 },
      }),
    );
    const rounding = result.adjustments.at(-1);
    expect(rounding?.kind).toBe('rounding');
    expect(rounding?.code).toBe('cash-rounding');
    expect(rounding?.amount).toBe(500);
    expect(rounding?.taxable).toBe(false);
    expect(result.totals.grandTotal).toBe(196000);
    expect(result.totals.grandTotal % 1000).toBe(0);
  });

  it('subtracts 400 to land 195400 on the 1000 multiple', () => {
    const result = priceCart(
      mockupInput({
        adjustments: [{ kind: 'discount', code: 'd', label: 'Giảm', amount: -24600 }],
        cashRounding: { multiple: 1000 },
      }),
    );
    expect(result.adjustments.at(-1)?.amount).toBe(-400);
    expect(result.totals.grandTotal).toBe(195000);
  });

  it('adds no adjustment when the provisional total is already on the multiple', () => {
    const result = priceCart(
      mockupInput({ cashRounding: { multiple: 1000 } }), // 220000 − 25000 = 195000
    );
    expect(result.adjustments).toHaveLength(1);
    expect(result.adjustments[0].code).toBe('mockup');
    expect(result.totals.grandTotal).toBe(195000);
  });
});

describe('priceCart — tax edge cases', () => {
  it('applies VAT 10% inclusive', () => {
    const result = priceCart(
      mockupInput({
        adjustments: [],
        tax: {
          enabled: true,
          pricesIncludeTax: true,
          defaultCategory: 'standard',
          categories: {
            standard: { label: 'VAT', rates: [{ ratePercent: 10, validFrom: '2020-01-01' }] },
          },
        },
      }),
    );
    expect(result.totals.taxTotal).toBe(20000); // round(220000*10/110)
    expect(result.totals.grandTotal).toBe(220000);
  });

  it('collects no tax when no rate is valid at `at`', () => {
    const result = priceCart(
      mockupInput({
        at: '2019-01-01T00:00:00.000Z',
        tax: vat8(true),
      }),
    );
    expect(result.totals.taxTotal).toBe(0);
    expect(result.lines.every((line) => line.taxSnapshot === null)).toBe(true);
    expect(result.totals.grandTotal).toBe(195000);
  });

  it('uses the line tax group ref over the default category', () => {
    const result = priceCart(
      mockupInput({
        lines: [{ key: 'a', quantity: 1, unitAmount: 100000, optionAmount: 0, taxGroupRef: 'reduced' }],
        adjustments: [],
        tax: {
          enabled: true,
          pricesIncludeTax: false,
          defaultCategory: 'standard',
          categories: {
            standard: { label: 'VAT', rates: [{ ratePercent: 8, validFrom: '2020-01-01' }] },
            reduced: { label: 'Giảm', rates: [{ ratePercent: 5, validFrom: '2020-01-01' }] },
          },
        },
      }),
    );
    expect(result.lines[0].taxAmount).toBe(5000);
    expect(result.lines[0].taxSnapshot?.category).toBe('reduced');
  });
});

describe('priceCart — validation', () => {
  const throwsWith = (input: PricingInput, code: string) => {
    try {
      priceCart(input);
      expect.unreachable('priceCart should have thrown');
    } catch (error) {
      expect(isOrderingError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(code);
    }
  };

  it('throws when a discount exceeds the subtotal', () => {
    throwsWith(
      mockupInput({
        adjustments: [{ kind: 'discount', code: 'd', label: 'Giảm', amount: -220001 }],
      }),
      'VALIDATION_ERROR',
    );
  });

  it('throws when percent and amount are both set', () => {
    throwsWith(
      mockupInput({
        adjustments: [{ kind: 'fee', code: 'f', label: 'Phí', amount: 1, percent: 5 }],
      }),
      'VALIDATION_ERROR',
    );
  });

  it('throws when neither percent nor amount is set', () => {
    throwsWith(
      mockupInput({ adjustments: [{ kind: 'fee', code: 'f', label: 'Phí' }] }),
      'VALIDATION_ERROR',
    );
  });

  it('throws on a positive discount or a negative fee', () => {
    throwsWith(
      mockupInput({ adjustments: [{ kind: 'discount', code: 'd', label: 'G', amount: 5 }] }),
      'VALIDATION_ERROR',
    );
    throwsWith(
      mockupInput({ adjustments: [{ kind: 'fee', code: 'f', label: 'P', amount: -5 }] }),
      'VALIDATION_ERROR',
    );
  });

  it('rejects bad quantities and amounts', () => {
    throwsWith(
      mockupInput({
        lines: [{ key: 'a', quantity: 0, unitAmount: 1, optionAmount: 0 }],
        adjustments: [],
      }),
      'VALIDATION_ERROR',
    );
    throwsWith(
      mockupInput({
        lines: [{ key: 'a', quantity: 1.5, unitAmount: 1, optionAmount: 0 }],
        adjustments: [],
      }),
      'MONEY_INVALID',
    );
    throwsWith(mockupInput({ fulfillmentAmount: -1, adjustments: [] }), 'VALIDATION_ERROR');
  });
});

describe('cartHash', () => {
  it('is deterministic for the same input', () => {
    expect(priceCart(mockupInput()).cartHash).toBe(priceCart(mockupInput()).cartHash);
  });

  it('changes when any priced input changes', () => {
    const base = priceCart(mockupInput()).cartHash;
    const changed = priceCart(
      mockupInput({
        lines: [
          { key: 'bun-bo', quantity: 2, unitAmount: 65001, optionAmount: 0 },
          { key: 'tra-dao', quantity: 1, unitAmount: 45000, optionAmount: 0 },
          { key: 'goi-cuon', quantity: 3, unitAmount: 15000, optionAmount: 0 },
        ],
      }),
    ).cartHash;
    expect(changed).not.toBe(base);
  });
});
