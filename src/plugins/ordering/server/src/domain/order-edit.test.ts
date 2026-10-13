import { describe, expect, it } from 'vitest';

import { isOrderingError } from './errors';
import {
  assertEditable,
  editability,
  assertHasEditRequest,
  assertReason,
  assertRevision,
  editWarnings,
  linesAfterReduce,
  planEditMoney,
  previewLines,
  priceEditedOrder,
  pricingLinesForEdit,
  type AddedPriceLine,
  type EditMoneyPayment,
  type SnapshotLine,
} from './order-edit';
import type { PricingAdjustmentInput, PricingInput } from './pricing/pipeline';
import type { TaxContext } from './pricing/tax';

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

const line = (overrides: Partial<SnapshotLine> = {}): SnapshotLine => ({
  lineId: 1,
  title: 'Bún bò',
  quantity: 2,
  canceledQuantity: 0,
  returnedQuantity: 0,
  unitAmount: 65_000,
  optionAmount: 0,
  ...overrides,
});

const mulberry32 = (seed: number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

describe('order edit guards', () => {
  it('allows pickup through preparing and delivery through ready', () => {
    expect(() => assertEditable('pickup', 'awaiting-acceptance')).not.toThrow();
    expect(() => assertEditable('pickup', 'preparing')).not.toThrow();
    expect(() => assertEditable('delivery', 'ready')).not.toThrow();
    expect(() => assertEditable('pickup', 'ready')).toThrow(/cannot be edited/);
    expect(() => assertEditable('delivery', 'awaiting-payment')).toThrow(/cannot be edited/);
    try {
      assertEditable('pickup', 'ready');
    } catch (error) {
      expect(isOrderingError(error) && error.code).toBe('ORDER_NOT_EDITABLE');
      expect(isOrderingError(error) && error.status).toBe(409);
      expect(isOrderingError(error) && error.details).toEqual({ status: 'ready' });
    }
  });

  it('rejects a stale revision and an empty edit', () => {
    expect(() => assertRevision(2, 3)).toThrow(/edited since/);
    try {
      assertRevision(1, 4);
    } catch (error) {
      expect(isOrderingError(error) && error.code).toBe('ORDER_CHANGED');
      expect(isOrderingError(error) && error.details).toEqual({ revision: 4 });
    }
    expect(() => assertRevision(0, 0)).not.toThrow();
    expect(() => assertHasEditRequest({})).toThrow(/does not change/);
    try {
      assertHasEditRequest({ add: [], reduce: [] });
    } catch (error) {
      expect(isOrderingError(error) && error.code).toBe('EDIT_EMPTY');
      expect(isOrderingError(error) && error.status).toBe(400);
    }
    expect(() => assertHasEditRequest({ timing: { kind: 'asap' } })).not.toThrow();
  });

  it('trims the reason and keeps it between 1 and 500 characters', () => {
    expect(assertReason('  hết món  ')).toBe('hết món');
    expect(() => assertReason('   ')).toThrow(/1–500/);
    expect(() => assertReason('x'.repeat(501))).toThrow(/1–500/);
  });
});

describe('editability for the order detail', () => {
  it('names why a group cannot be edited', () => {
    expect(editability('pickup', 'open', ['awaiting-acceptance'])).toEqual({ editable: true, reason: null });
    expect(editability('delivery', 'open', ['ready'])).toEqual({ editable: true, reason: null });
    expect(editability('pickup', 'open', ['ready'])).toEqual({ editable: false, reason: 'ready' });
    expect(editability('delivery', 'open', ['out-for-delivery'])).toEqual({
      editable: false,
      reason: 'out-for-delivery',
    });
    expect(editability('pickup', 'open', ['awaiting-payment'])).toEqual({
      editable: false,
      reason: 'awaiting-payment',
    });
    expect(editability('pickup', 'draft', ['awaiting-acceptance'])).toEqual({ editable: false, reason: 'draft' });
    expect(editability('pickup', 'completed', [])).toEqual({ editable: false, reason: 'closed' });
    expect(editability('pickup', 'open', [])).toEqual({ editable: false, reason: 'closed' });
    expect(editability('delivery', 'open', ['failed'])).toEqual({ editable: false, reason: 'closed' });
    expect(editability('pickup', 'open', ['preparing', 'ready'])).toEqual({ editable: false, reason: 'ready' });
  });
});

describe('lines after a reduction', () => {
  it('keeps the placement price and refuses to cancel more than the remainder', () => {
    const edited = linesAfterReduce(
      [line({ quantity: 4, canceledQuantity: 1, returnedQuantity: 1, unitAmount: 65_000, optionAmount: 10_000 })],
      [{ lineId: 1, quantity: 1 }],
    );
    expect(edited[0]).toMatchObject({
      quantityBefore: 2,
      quantityAfter: 1,
      unitAmount: 65_000,
      optionAmount: 10_000,
    });
    expect(() => linesAfterReduce([line()], [{ lineId: 1, quantity: 3 }])).toThrow(/remainder/);
    expect(() => linesAfterReduce([line()], [{ lineId: 9, quantity: 1 }])).toThrow(/does not belong/);
    const priced = pricingLinesForEdit(linesAfterReduce([line()], [{ lineId: 1, quantity: 2 }]), []);
    expect(priced).toEqual([]);
  });
});

describe('planEditMoney', () => {
  const cash = (id: number, captured: number, pendingRefund = 0): EditMoneyPayment => ({
    id,
    providerCode: 'cash',
    captured,
    refunded: 0,
    pendingRefund,
  });
  const transfer = (id: number, captured: number, pendingRefund = 0): EditMoneyPayment => ({
    id,
    providerCode: 'sepay',
    captured,
    refunded: 0,
    pendingRefund,
  });

  it('refunds a transfer before cash when both paid the order', () => {
    const plan = planEditMoney({
      newTotal: 65_000,
      payments: [cash(2, 80_000), transfer(1, 50_000)],
    });
    expect(plan.paid).toBe(130_000);
    expect(plan.refunds).toEqual([
      { paymentId: 1, providerCode: 'sepay', amount: 50_000, settlement: 'pending' },
      { paymentId: 2, providerCode: 'cash', amount: 15_000, settlement: 'settled' },
    ]);
    expect(plan.refundTransferPending).toBe(50_000);
    expect(plan.refundCash).toBe(15_000);
    expect(plan.extraDue).toBe(0);
    expect(plan.dueAfter).toBe(0);
    expect(plan.paymentLink).toBe(false);
  });

  it('stops at the transfer when that room covers the surplus', () => {
    const plan = planEditMoney({
      newTotal: 80_000,
      payments: [cash(1, 50_000), transfer(2, 70_000, 10_000)],
    });
    expect(plan.paid).toBe(110_000);
    expect(plan.refunds).toEqual([
      { paymentId: 2, providerCode: 'sepay', amount: 30_000, settlement: 'pending' },
    ]);
    expect(plan.refundCash).toBe(0);
  });

  it('issues a link for the increase when an online payment was captured', () => {
    const plan = planEditMoney({
      newTotal: 180_000,
      payments: [transfer(4, 130_000)],
    });
    expect(plan.extraDue).toBe(50_000);
    expect(plan.dueAfter).toBe(50_000);
    expect(plan.paymentLink).toBe(true);
    expect(plan.refunds).toEqual([]);
  });

  it('lets a pay-on-pickup increase raise the amount due without a link', () => {
    const plan = planEditMoney({
      newTotal: 180_000,
      payments: [cash(1, 130_000)],
    });
    expect(plan.extraDue).toBe(50_000);
    expect(plan.paymentLink).toBe(false);
    const unpaid = planEditMoney({ newTotal: 50_000, payments: [] });
    expect(unpaid.paid).toBe(0);
    expect(unpaid.extraDue).toBe(50_000);
    expect(unpaid.paymentLink).toBe(false);
  });
});

describe('priceEditedOrder', () => {
  const added: AddedPriceLine = {
    title: 'Trà đào',
    quantity: 1,
    unitAmount: 45_000,
    optionAmount: 0,
  };

  it('prices a kept line at the old snapshot and an added line at the new price', () => {
    const existing = linesAfterReduce([line()], [{ lineId: 1, quantity: 1 }]);
    const priced = priceEditedOrder({
      currency: 'VND',
      lines: pricingLinesForEdit(existing, [added]),
      adjustments: [{ kind: 'discount', code: 'promo', label: 'Khuyến mãi', amount: -10_000, ruleSnapshot: { id: 'promo' } }],
      fulfillmentAmount: 15_000,
      tax: TAX_OFF,
      at: '2026-10-12T08:00:00.000Z',
      cashRounding: null,
    });
    expect(priced.lines.map((row) => [row.key, row.quantity, row.unitAmount])).toEqual([
      ['line:1', 1, 65_000],
      ['add:0', 1, 45_000],
    ]);
    expect(priced.totals.grandTotal).toBe(65_000 + 45_000 - 10_000 + 15_000);
    expect(editWarnings({ subtotal: priced.totals.subtotal, minOrderAmount: 200_000, keptDiscount: true })).toEqual([
      'below-min-order',
      'promotion-kept',
    ]);
    const shown = previewLines({ existing, added: [added], priced: priced.lines });
    expect(shown[0]).toMatchObject({ lineId: 1, quantityBefore: 2, quantityAfter: 1, added: false });
    expect(shown[1]).toMatchObject({ quantityBefore: 0, quantityAfter: 1, added: true, title: 'Trà đào' });
    expect(shown.reduce((sum, row) => sum + row.lineTotalAfter, 0) + 15_000).toBe(priced.totals.grandTotal);
  });

  it('keeps grand total = remaining lines + adjustments + fulfillment + tax across 400 carts', () => {
    const random = mulberry32(20261012);
    const pick = (maxExclusive: number) => Math.floor(random() * maxExclusive);
    for (let index = 0; index < 400; index += 1) {
      const lineCount = 1 + pick(6);
      const lines = Array.from({ length: lineCount }, (_, lineIndex) => ({
        key: `l${lineIndex}`,
        quantity: 1 + pick(4),
        unitAmount: pick(80) * 1_000,
        optionAmount: pick(10) * 1_000,
      }));
      const subtotal = lines.reduce((sum, row) => sum + (row.unitAmount + row.optionAmount) * row.quantity, 0);
      const adjustments: PricingAdjustmentInput[] = [];
      let budget = subtotal;
      if (pick(2) === 0 && budget > 0) {
        const amount = pick(Math.min(budget, 50_000) + 1);
        budget -= amount;
        adjustments.push({
          kind: 'discount',
          code: 'd',
          label: 'Discount',
          amount: -amount,
          ruleSnapshot: { id: 'kept' },
        });
      }
      if (pick(2) === 0) {
        adjustments.push({ kind: 'fee', code: 'f', label: 'Fee', amount: pick(10) * 1_000 });
      }
      const taxMode = pick(3);
      const tax = taxMode === 0 ? TAX_OFF : VAT8(taxMode === 1);
      const input: PricingInput = {
        currency: 'VND',
        lines,
        adjustments,
        fulfillmentAmount: pick(5) * 5_000,
        tax,
        at: '2026-10-12T08:00:00.000Z',
        cashRounding: taxMode === 2 || random() < 0.5 ? null : { multiple: 1_000 },
      };
      const priced = priceEditedOrder(input);
      const exclusive = tax.enabled && !tax.pricesIncludeTax;
      const fromParts =
        priced.totals.subtotal +
        priced.totals.adjustmentTotal +
        priced.totals.fulfillmentTotal +
        (exclusive ? priced.totals.taxTotal : 0);
      const fromLines =
        priced.lines.reduce((sum, row) => sum + row.lineTotalAmount, 0) + priced.totals.fulfillmentTotal;
      expect(priced.totals.grandTotal, `cart ${index}`).toBe(fromParts);
      expect(priced.totals.grandTotal, `cart ${index} lines`).toBe(fromLines);
    }
  });

  it('places every random surplus on transfer payments before cash', () => {
    const random = mulberry32(77);
    const pick = (maxExclusive: number) => Math.floor(random() * maxExclusive);
    for (let index = 0; index < 200; index += 1) {
      const payments: EditMoneyPayment[] = [];
      const count = 1 + pick(4);
      for (let paymentIndex = 0; paymentIndex < count; paymentIndex += 1) {
        const captured = pick(20) * 5_000;
        const refunded = pick(captured / 5_000 + 1) * 5_000;
        const pendingRefund = pick((captured - refunded) / 5_000 + 1) * 5_000;
        payments.push({
          id: paymentIndex + 1,
          providerCode: pick(2) === 0 ? 'cash' : 'sepay',
          captured,
          refunded,
          pendingRefund,
        });
      }
      const paid = payments.reduce(
        (sum, payment) => sum + Math.max(0, payment.captured - payment.refunded - payment.pendingRefund),
        0,
      );
      const newTotal = pick(paid / 1_000 + 8) * 1_000;
      const plan = planEditMoney({ newTotal, payments });
      expect(plan.paid, `case ${index}`).toBe(paid);
      expect(plan.refundCash + plan.refundTransferPending, `case ${index} refund`).toBe(Math.max(0, paid - newTotal));
      expect(plan.extraDue, `case ${index} extra`).toBe(Math.max(0, newTotal - paid));
      expect(plan.dueAfter).toBe(plan.extraDue);
      const kinds = plan.refunds.map((refund) => refund.settlement);
      const firstCash = kinds.indexOf('settled');
      const lastTransfer = kinds.lastIndexOf('pending');
      if (firstCash !== -1 && lastTransfer !== -1) {
        expect(lastTransfer, `case ${index} order`).toBeLessThan(firstCash);
      }
      expect(plan.paymentLink).toBe(
        plan.extraDue > 0 && payments.some((payment) => payment.providerCode !== 'cash' && payment.captured - payment.refunded > 0),
      );
    }
  });
});
