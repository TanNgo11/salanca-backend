import { createHash } from 'node:crypto';

import { OrderingError } from '../errors';
import { assertSafeAmount, roundHalfAwayFromZero } from '../money';
import { allocateLargestRemainder } from './allocation';
import { cashRoundingDelta } from './cash-rounding';
import { resolveTaxRate, taxForLineAmount, type TaxContext } from './tax';

export type PricingLineInput = {
  key: string;
  quantity: number;
  unitAmount: number;
  optionAmount: number;
  taxGroupRef?: string;
};

/**
 * Where an adjustment lands. `order` (the default) keeps the O1 behavior: percent of the
 * subtotal, split across every line. `lines` prices and splits only the named lines.
 * `fulfillment` changes the delivery fee and has no line allocation.
 */
export type PricingTarget =
  | { kind: 'order' }
  | { kind: 'lines'; lineIndexes: number[] }
  | { kind: 'fulfillment' };

export type PricingAdjustmentInput = {
  kind: 'discount' | 'fee' | 'rounding';
  code: string;
  label: string;
  amount?: number;
  percent?: number;
  taxable?: boolean;
  priority?: number;
  sourceRef?: string;
  ruleSnapshot?: Record<string, unknown>;
  /** Defaults to the whole order. */
  target?: PricingTarget;
};

export type PricingInput = {
  currency: string;
  lines: PricingLineInput[];
  adjustments: PricingAdjustmentInput[];
  fulfillmentAmount: number;
  tax: TaxContext;
  at: string;
  cashRounding?: { multiple: number } | null;
};

export type PricedAllocation = {
  adjustmentIndex: number;
  lineKey: string;
  weight: number;
  amount: number;
};

export type PricedLine = PricingLineInput & {
  baseAmount: number;
  discountAmount: number;
  feeAmount: number;
  roundingDelta: number;
  taxAmount: number;
  lineTotalAmount: number;
  taxSnapshot: { category: string; ratePercent: number; inclusive: boolean } | null;
  allocations: Array<{ adjustmentIndex: number; weight: number; amount: number }>;
};

export type PricedAdjustment = {
  kind: 'discount' | 'fee' | 'rounding';
  code: string;
  label: string;
  amount: number;
  taxable: boolean;
  priority: number;
  sourceRef?: string;
  ruleSnapshot?: Record<string, unknown>;
  target: PricingTarget;
  allocations: Array<{ lineKey: string; weight: number; amount: number }>;
};

export type PricingResult = {
  currency: string;
  lines: PricedLine[];
  adjustments: PricedAdjustment[];
  totals: {
    subtotal: number;
    adjustmentTotal: number;
    fulfillmentTotal: number;
    taxTotal: number;
    grandTotal: number;
  };
  cartHash: string;
};

const validationError = (message: string): never => {
  throw new OrderingError('VALIDATION_ERROR', message);
};

type ResolvedAdjustment = {
  kind: 'discount' | 'fee' | 'rounding';
  code: string;
  label: string;
  amount: number;
  taxable: boolean;
  priority: number;
  inputIndex: number;
  sourceRef?: string;
  ruleSnapshot?: Record<string, unknown>;
  target: PricingTarget;
  /** Line indexes this adjustment allocates to. Empty for a fulfillment target. */
  lineIndexes: number[];
};

const targetOf = (
  adjustment: PricingAdjustmentInput,
  index: number,
  lineCount: number,
): PricingTarget => {
  const target = adjustment.target ?? { kind: 'order' };
  if (target.kind === 'order') return { kind: 'order' };
  if (target.kind === 'fulfillment') {
    if (adjustment.kind === 'rounding') {
      validationError(`adjustments[${index}] rounding cannot target fulfillment`);
    }
    return { kind: 'fulfillment' };
  }
  if (target.kind !== 'lines') {
    validationError(`adjustments[${index}].target is not supported`);
  }
  const indexes = target.lineIndexes;
  if (!Array.isArray(indexes) || indexes.length === 0) {
    validationError(`adjustments[${index}].target.lineIndexes must not be empty`);
  }
  const seen = new Set<number>();
  for (const lineIndex of indexes) {
    if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lineCount) {
      validationError(`adjustments[${index}].target.lineIndexes is out of range`);
    }
    if (seen.has(lineIndex)) {
      validationError(`adjustments[${index}].target.lineIndexes must be unique`);
    }
    seen.add(lineIndex);
  }
  return { kind: 'lines', lineIndexes: [...indexes] };
};

/**
 * Pure pricing of an already-resolved cart: catalog lookups, availability, consent and
 * product-type quoting happen before this point (contracts §6 steps 1–5); this function owns
 * the money math — line bases, order adjustments with largest-remainder allocation, optional
 * cash rounding, tax, totals and the tamper-evident cart hash. No I/O, no Strapi.
 */
export function priceCart(input: PricingInput): PricingResult {
  // 1. Validate inputs and compute line bases.
  assertSafeAmount(input.fulfillmentAmount, 'fulfillmentAmount');
  if (input.fulfillmentAmount < 0) validationError('fulfillmentAmount must be >= 0');
  const lines = input.lines.map((line, index) => {
    assertSafeAmount(line.quantity, `lines[${index}].quantity`);
    if (line.quantity < 1) validationError(`lines[${index}].quantity must be >= 1`);
    assertSafeAmount(line.unitAmount, `lines[${index}].unitAmount`);
    assertSafeAmount(line.optionAmount, `lines[${index}].optionAmount`);
    if (line.unitAmount < 0 || line.optionAmount < 0) {
      validationError(`lines[${index}] amounts must be >= 0`);
    }
    const baseAmount = assertSafeAmount(
      (line.unitAmount + line.optionAmount) * line.quantity,
      `lines[${index}].baseAmount`,
    );
    return { ...line, baseAmount };
  });
  const weights = lines.map((line) => line.baseAmount);
  const subtotal = assertSafeAmount(
    lines.reduce((sum, line) => sum + line.baseAmount, 0),
    'subtotal',
  );

  // 2. Resolve adjustment amounts. Percent uses the target base: the whole subtotal, the
  //    selected lines, or the delivery fee. Rounding stays half-away-from-zero here; promotion
  //    evaluation floors its own percent before passing an amount.
  const resolved: ResolvedAdjustment[] = input.adjustments.map((adjustment, index) => {
    const target = targetOf(adjustment, index, lines.length);
    const lineIndexes =
      target.kind === 'order'
        ? lines.map((_, lineIndex) => lineIndex)
        : target.kind === 'lines'
          ? target.lineIndexes
          : [];
    const percentBase =
      target.kind === 'fulfillment'
        ? input.fulfillmentAmount
        : lineIndexes.reduce((sum, lineIndex) => sum + lines[lineIndex].baseAmount, 0);
    if ((adjustment.amount === undefined) === (adjustment.percent === undefined)) {
      validationError(`adjustments[${index}] needs exactly one of amount or percent`);
    }
    let amount: number;
    if (adjustment.amount !== undefined) {
      amount = assertSafeAmount(adjustment.amount, `adjustments[${index}].amount`);
    } else {
      if (adjustment.kind === 'rounding') {
        validationError(`adjustments[${index}] rounding cannot use percent`);
      }
      const percent = adjustment.percent ?? 0;
      if (!Number.isFinite(percent)) validationError(`adjustments[${index}].percent must be finite`);
      const raw = roundHalfAwayFromZero((percentBase * percent) / 100);
      amount = adjustment.kind === 'discount' ? -Math.abs(raw) : Math.abs(raw);
    }
    if (adjustment.kind === 'discount' && amount > 0) {
      validationError(`adjustments[${index}] discount must be <= 0`);
    }
    if (adjustment.kind === 'fee' && amount < 0) {
      validationError(`adjustments[${index}] fee must be >= 0`);
    }
    if (adjustment.kind === 'discount' && target.kind !== 'order' && -amount > percentBase) {
      throw new OrderingError(
        'VALIDATION_ERROR',
        target.kind === 'fulfillment'
          ? 'discount exceeds fulfillment'
          : 'discount exceeds target lines',
        { details: { subtotal: percentBase } },
      );
    }
    return {
      kind: adjustment.kind,
      code: adjustment.code,
      label: adjustment.label,
      amount,
      taxable: adjustment.taxable ?? true,
      priority: adjustment.priority ?? 0,
      inputIndex: index,
      sourceRef: adjustment.sourceRef,
      ruleSnapshot: adjustment.ruleSnapshot,
      target,
      lineIndexes,
    };
  });
  resolved.sort((a, b) => a.priority - b.priority || a.inputIndex - b.inputIndex);

  // 3. Discounts cannot push the order below zero — rejected outright, never clamped.
  //    A delivery discount is checked against the fee, not the food subtotal.
  const lineDiscountTotal = resolved
    .filter((adjustment) => adjustment.kind === 'discount' && adjustment.target.kind !== 'fulfillment')
    .reduce((sum, adjustment) => sum + adjustment.amount, 0);
  if (subtotal + lineDiscountTotal < 0) {
    throw new OrderingError('VALIDATION_ERROR', 'discount exceeds subtotal', {
      details: { subtotal },
    });
  }
  const fulfillmentDiscountTotal = resolved
    .filter((adjustment) => adjustment.kind === 'discount' && adjustment.target.kind === 'fulfillment')
    .reduce((sum, adjustment) => sum + adjustment.amount, 0);
  if (input.fulfillmentAmount + fulfillmentDiscountTotal < 0) {
    throw new OrderingError('VALIDATION_ERROR', 'discount exceeds fulfillment', {
      details: { subtotal: input.fulfillmentAmount },
    });
  }

  // 4. Cash rounding lands after all input adjustments so the quoted cash total sits on the
  //    multiple. It is a non-taxable `rounding` adjustment; when tax is exclusive the tax added
  //    on top may move the grand total off the multiple (v1 ships tax disabled).
  if (input.cashRounding) {
    const provisional = assertSafeAmount(
      resolved.reduce(
        (sum, adjustment) => sum + adjustment.amount,
        subtotal + input.fulfillmentAmount,
      ),
      'provisional',
    );
    const delta = cashRoundingDelta(provisional, input.cashRounding.multiple);
    if (delta !== 0) {
      resolved.push({
        kind: 'rounding',
        code: 'cash-rounding',
        label: 'Làm tròn tiền mặt',
        amount: delta,
        taxable: false,
        // int4 max: "sorts after everything" while still fitting the adjustment column.
        priority: 2147483647,
        inputIndex: resolved.length,
        target: { kind: 'order' },
        lineIndexes: lines.map((_, lineIndex) => lineIndex),
      });
    }
  }

  // 5. Allocate line adjustments. A fulfillment adjustment changes the fee and stores no
  //    allocation, so Σ allocation === amount stays true for every line adjustment.
  const pricedLines: PricedLine[] = lines.map((line) => ({
    ...line,
    discountAmount: 0,
    feeAmount: 0,
    roundingDelta: 0,
    taxAmount: 0,
    lineTotalAmount: line.baseAmount,
    taxSnapshot: null,
    allocations: [],
  }));
  const adjustments: PricedAdjustment[] = resolved.map((adjustment, adjustmentIndex) => {
    if (adjustment.target.kind === 'fulfillment') {
      return {
        kind: adjustment.kind,
        code: adjustment.code,
        label: adjustment.label,
        amount: adjustment.amount,
        taxable: adjustment.taxable,
        priority: adjustment.priority,
        sourceRef: adjustment.sourceRef,
        ruleSnapshot: adjustment.ruleSnapshot,
        target: adjustment.target,
        allocations: [],
      };
    }
    const targetWeights = adjustment.lineIndexes.map((lineIndex) => weights[lineIndex]);
    const shares = allocateLargestRemainder(adjustment.amount, targetWeights);
    const allocations = shares.map((amount, shareIndex) => {
      const lineIndex = adjustment.lineIndexes[shareIndex];
      return { lineKey: lines[lineIndex].key, weight: weights[lineIndex], amount };
    });
    const allocatedSum = shares.reduce((sum, amount) => sum + amount, 0);
    if (allocatedSum !== adjustment.amount) {
      throw new OrderingError('TOTALS_MISMATCH', 'allocation does not sum to the adjustment', {
        details: { code: adjustment.code },
      });
    }
    if (adjustment.kind === 'discount' && adjustment.target.kind === 'lines') {
      adjustment.lineIndexes.forEach((lineIndex, shareIndex) => {
        const line = pricedLines[lineIndex];
        if (line.baseAmount + line.discountAmount + shares[shareIndex] < 0) {
          throw new OrderingError('VALIDATION_ERROR', 'discount exceeds target lines', {
            details: { subtotal: line.baseAmount },
          });
        }
      });
    }
    adjustment.lineIndexes.forEach((lineIndex, shareIndex) => {
      const line = pricedLines[lineIndex];
      const amount = shares[shareIndex];
      if (adjustment.kind === 'discount') line.discountAmount += amount;
      else if (adjustment.kind === 'fee') line.feeAmount += amount;
      else line.roundingDelta += amount;
      line.allocations.push({ adjustmentIndex, weight: weights[lineIndex], amount });
    });
    return {
      kind: adjustment.kind,
      code: adjustment.code,
      label: adjustment.label,
      amount: adjustment.amount,
      taxable: adjustment.taxable,
      priority: adjustment.priority,
      sourceRef: adjustment.sourceRef,
      ruleSnapshot: adjustment.ruleSnapshot,
      target: adjustment.target,
      allocations,
    };
  });

  // 6. Tax per line on the post-adjustment net; inclusive tax stays inside lineNet.
  for (const line of pricedLines) {
    const net = assertSafeAmount(
      line.baseAmount + line.discountAmount + line.feeAmount + line.roundingDelta,
      'lineNet',
    );
    const rate = resolveTaxRate(input.tax, line.taxGroupRef, input.at);
    if (rate === null) {
      line.taxAmount = 0;
      line.taxSnapshot = null;
      line.lineTotalAmount = net;
      continue;
    }
    const inclusive = input.tax.pricesIncludeTax;
    line.taxAmount = taxForLineAmount(net, rate.ratePercent, inclusive);
    line.taxSnapshot = { ...rate, inclusive };
    line.lineTotalAmount = assertSafeAmount(inclusive ? net : net + line.taxAmount, 'lineTotal');
  }

  // 7. Totals. A fulfillment adjustment is not in `adjustmentTotal`: its amount is already
  //    inside the net delivery fee, so both identities hold:
  //    grand = Σ line totals + net fulfillment
  //    grand = subtotal + line adjustments + net fulfillment + exclusive tax.
  const fulfillmentEffect = adjustments
    .filter((adjustment) => adjustment.target.kind === 'fulfillment')
    .reduce((sum, adjustment) => sum + adjustment.amount, 0);
  const fulfillmentTotal = assertSafeAmount(input.fulfillmentAmount + fulfillmentEffect, 'fulfillmentTotal');
  const adjustmentTotal = adjustments
    .filter((adjustment) => adjustment.target.kind !== 'fulfillment')
    .reduce((sum, adjustment) => sum + adjustment.amount, 0);
  const taxTotal = pricedLines.reduce((sum, line) => sum + line.taxAmount, 0);
  const grandTotal = assertSafeAmount(
    pricedLines.reduce((sum, line) => sum + line.lineTotalAmount, 0) + fulfillmentTotal,
    'grandTotal',
  );
  const exclusiveTax = input.tax.enabled && !input.tax.pricesIncludeTax;
  const expected = subtotal + adjustmentTotal + fulfillmentTotal + (exclusiveTax ? taxTotal : 0);
  if (grandTotal !== expected) {
    throw new OrderingError('TOTALS_MISMATCH', 'priced totals do not add up', {
      details: { grandTotal, expected },
    });
  }

  // 8. Tamper-evident hash over the inputs that produced this quote plus the totals.
  const cartHash = createHash('sha256')
    .update(
      JSON.stringify({
        currency: input.currency,
        lines: lines.map((line) => [line.key, line.quantity, line.unitAmount, line.optionAmount]),
        adjustments: adjustments.map((adjustment) => [
          adjustment.kind,
          adjustment.code,
          adjustment.amount,
          adjustment.target.kind,
        ]),
        fulfillmentAmount: input.fulfillmentAmount,
        totals: {
          subtotal,
          adjustmentTotal,
          fulfillmentTotal,
          taxTotal,
          grandTotal,
        },
      }),
    )
    .digest('hex');

  return {
    currency: input.currency,
    lines: pricedLines,
    adjustments,
    totals: {
      subtotal,
      adjustmentTotal,
      fulfillmentTotal,
      taxTotal,
      grandTotal,
    },
    cartHash,
  };
}
