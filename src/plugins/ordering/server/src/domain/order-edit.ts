import { OrderingError } from './errors';
import { priceCart, type PricingInput, type PricingResult } from './pricing/pipeline';

/**
 * Pure order-edit math. No Strapi and no database.
 *
 * Refund order when the new total is below what is still held: non-cash
 * (transfer) payments first, cash after that. Inside one kind, the smaller
 * payment id goes first, so two clerks build the same plan. Cash settles
 * immediately. A transfer refund stays pending until someone records the bank
 * transfer. A pay-on-pickup increase only raises the amount due. An increase
 * on an order that already has a captured online payment is collected with a
 * payment link and does not move the kitchen group.
 */

export type SnapshotLine = {
  lineId: number;
  title: string;
  quantity: number;
  canceledQuantity: number;
  returnedQuantity: number;
  unitAmount: number;
  optionAmount: number;
  taxGroupRef?: string;
};

export type AddedPriceLine = {
  title: string;
  quantity: number;
  unitAmount: number;
  optionAmount: number;
  taxGroupRef?: string;
};

export type EditMoneyPayment = {
  id: number;
  providerCode: string;
  captured: number;
  refunded: number;
  pendingRefund: number;
};

export type EditRefundLeg = {
  paymentId: number;
  providerCode: string;
  amount: number;
  /** Cash settles now. A transfer stays pending until the bank transfer is recorded. */
  settlement: 'settled' | 'pending';
};

export type EditMoneyPlan = {
  paid: number;
  dueAfter: number;
  refundCash: number;
  refundTransferPending: number;
  extraDue: number;
  paymentLink: boolean;
  refunds: EditRefundLeg[];
};

export type EditPreviewLine = {
  lineId?: number;
  title: string;
  quantityBefore: number;
  quantityAfter: number;
  lineTotalAfter: number;
  added: boolean;
};

export type EditTotals = {
  subtotal: number;
  adjustment: number;
  fulfillment: number;
  tax: number;
  total: number;
};

const PICKUP_EDITABLE = new Set(['awaiting-acceptance', 'preparing']);

export const liveQuantity = (line: {
  quantity: number;
  canceledQuantity: number;
  returnedQuantity?: number;
}): number => line.quantity - line.canceledQuantity - (line.returnedQuantity ?? 0);

/** Pickup can be edited while the kitchen has not marked it ready. Delivery may also be edited at ready. */
export const editableGroup = (receiveKind: string, status: string): boolean => {
  if (PICKUP_EDITABLE.has(status)) return true;
  return receiveKind === 'delivery' && status === 'ready';
};

export const assertEditable = (receiveKind: string, status: string): void => {
  if (!editableGroup(receiveKind, status)) {
    throw new OrderingError('ORDER_NOT_EDITABLE', 'this order cannot be edited', {
      details: { status },
    });
  }
};

/**
 * Why the detail screen hides the edit button. `openStatuses` are the
 * non-terminal groups. A code is translated in the admin (`edit.reason.*`).
 */
export const editability = (
  receiveKind: string,
  orderStatus: string,
  openStatuses: readonly string[],
): { editable: boolean; reason: string | null } => {
  if (orderStatus === 'draft') return { editable: false, reason: 'draft' };
  if (orderStatus === 'completed' || orderStatus === 'canceled') return { editable: false, reason: 'closed' };
  if (openStatuses.length === 0) return { editable: false, reason: 'closed' };
  for (const status of openStatuses) {
    if (editableGroup(receiveKind, status)) continue;
    if (status === 'awaiting-payment') return { editable: false, reason: 'awaiting-payment' };
    if (status === 'out-for-delivery') return { editable: false, reason: 'out-for-delivery' };
    if (status === 'ready') return { editable: false, reason: 'ready' };
    return { editable: false, reason: 'closed' };
  }
  return { editable: true, reason: null };
};

export const assertRevision = (seen: unknown, current: number): void => {
  if (typeof seen !== 'number' || !Number.isInteger(seen) || seen < 0) {
    throw new OrderingError('VALIDATION_ERROR', 'revision must be a non-negative integer', {
      details: { field: 'revision' },
    });
  }
  if (seen !== current) {
    throw new OrderingError('ORDER_CHANGED', 'the order was edited since it was opened', {
      details: { revision: current },
    });
  }
};

export const assertReason = (reason: unknown): string => {
  if (typeof reason !== 'string') {
    throw new OrderingError('VALIDATION_ERROR', 'reason is required', { details: { field: 'reason' } });
  }
  const trimmed = reason.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    throw new OrderingError('VALIDATION_ERROR', 'reason must be 1–500 characters', {
      details: { field: 'reason' },
    });
  }
  return trimmed;
};

export const assertHasEditRequest = (input: {
  add?: readonly unknown[] | undefined;
  reduce?: readonly unknown[] | undefined;
  timing?: unknown;
  address?: unknown;
}): void => {
  const add = input.add?.length ?? 0;
  const reduce = input.reduce?.length ?? 0;
  if (add === 0 && reduce === 0 && input.timing === undefined && input.address === undefined) {
    throw new OrderingError('EDIT_EMPTY', 'the edit does not change the order');
  }
};

/** Sums duplicate line ids. Every quantity is a positive integer. */
export const reductionsByLine = (
  reduce: ReadonlyArray<{ lineId: number; quantity: number }> | undefined,
): Map<number, number> => {
  const map = new Map<number, number>();
  for (const [index, row] of (reduce ?? []).entries()) {
    if (!Number.isInteger(row.lineId) || row.lineId <= 0) {
      throw new OrderingError('VALIDATION_ERROR', 'lineId must be a positive integer', {
        details: { field: 'reduce', index },
      });
    }
    if (!Number.isInteger(row.quantity) || row.quantity <= 0) {
      throw new OrderingError('VALIDATION_ERROR', 'quantity must be a positive integer', {
        details: { field: 'reduce', index },
      });
    }
    map.set(row.lineId, (map.get(row.lineId) ?? 0) + row.quantity);
  }
  return map;
};

export type LineAfterReduce = SnapshotLine & { quantityBefore: number; quantityAfter: number };

/**
 * Applies reductions on top of the still-live quantity. Existing unit and option
 * prices stay at the placement snapshot.
 */
export const linesAfterReduce = (
  lines: readonly SnapshotLine[],
  reduce: ReadonlyArray<{ lineId: number; quantity: number }> | undefined,
): LineAfterReduce[] => {
  const byId = reductionsByLine(reduce);
  const known = new Set(lines.map((line) => line.lineId));
  for (const lineId of byId.keys()) {
    if (!known.has(lineId)) {
      throw new OrderingError('LINE_INVALID', 'line does not belong to the order', {
        details: { lineId },
      });
    }
  }
  return lines.map((line) => {
    const quantityBefore = liveQuantity(line);
    const cut = byId.get(line.lineId) ?? 0;
    if (cut > quantityBefore) {
      throw new OrderingError('LINE_QUANTITY_EXCEEDED', 'cancel quantity exceeds the line remainder', {
        details: { lineId: line.lineId, remaining: quantityBefore },
      });
    }
    return { ...line, quantityBefore, quantityAfter: quantityBefore - cut };
  });
};

export const pricingKeyForLine = (lineId: number): string => `line:${lineId}`;
export const pricingKeyForAdded = (index: number): string => `add:${index}`;

/** Lines the pipeline prices. A line reduced to zero drops out. Old prices are the stored snapshot. */
export const pricingLinesForEdit = (
  existing: readonly LineAfterReduce[],
  added: readonly AddedPriceLine[],
): PricingInput['lines'] => {
  const lines: PricingInput['lines'] = [];
  for (const line of existing) {
    if (line.quantityAfter <= 0) continue;
    lines.push({
      key: pricingKeyForLine(line.lineId),
      quantity: line.quantityAfter,
      unitAmount: line.unitAmount,
      optionAmount: line.optionAmount,
      ...(line.taxGroupRef ? { taxGroupRef: line.taxGroupRef } : {}),
    });
  }
  added.forEach((line, index) => {
    lines.push({
      key: pricingKeyForAdded(index),
      quantity: line.quantity,
      unitAmount: line.unitAmount,
      optionAmount: line.optionAmount,
      ...(line.taxGroupRef ? { taxGroupRef: line.taxGroupRef } : {}),
    });
  });
  return lines;
};

/**
 * Reprices the edited cart and checks the order-total identity:
 * grand total = Σ remaining line totals + fulfillment,
 * and grand total = subtotal + adjustments + fulfillment + exclusive tax.
 */
export const priceEditedOrder = (input: PricingInput): PricingResult => {
  if (input.lines.length === 0) {
    throw new OrderingError('VALIDATION_ERROR', 'an order needs at least one line', {
      details: { field: 'reduce' },
    });
  }
  const priced = priceCart(input);
  const exclusive = input.tax.enabled && !input.tax.pricesIncludeTax;
  const fromParts =
    priced.totals.subtotal +
    priced.totals.adjustmentTotal +
    priced.totals.fulfillmentTotal +
    (exclusive ? priced.totals.taxTotal : 0);
  const fromLines =
    priced.lines.reduce((sum, line) => sum + line.lineTotalAmount, 0) + priced.totals.fulfillmentTotal;
  if (priced.totals.grandTotal !== fromParts || priced.totals.grandTotal !== fromLines) {
    throw new OrderingError('TOTALS_MISMATCH', 'priced totals do not add up', {
      details: { grandTotal: priced.totals.grandTotal, fromParts, fromLines },
    });
  }
  return priced;
};

const roomOf = (payment: EditMoneyPayment): number =>
  Math.max(0, payment.captured - payment.refunded - payment.pendingRefund);

const assertPayment = (payment: EditMoneyPayment, index: number): void => {
  for (const field of ['id', 'captured', 'refunded', 'pendingRefund'] as const) {
    const value = payment[field];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new OrderingError('VALIDATION_ERROR', `${field} must be a non-negative integer`, {
        details: { field, index },
      });
    }
  }
};

/**
 * Splits the difference between the amount still held and the new total.
 * Transfer refunds are planned before cash refunds.
 */
export const planEditMoney = (input: {
  newTotal: number;
  payments: readonly EditMoneyPayment[];
}): EditMoneyPlan => {
  if (!Number.isSafeInteger(input.newTotal) || input.newTotal < 0) {
    throw new OrderingError('VALIDATION_ERROR', 'new total must be a non-negative integer');
  }
  input.payments.forEach(assertPayment);
  const paid = input.payments.reduce((sum, payment) => sum + roomOf(payment), 0);
  const surplus = Math.max(0, paid - input.newTotal);
  const extraDue = Math.max(0, input.newTotal - paid);
  const capturedOnline = input.payments.some(
    (payment) => payment.providerCode !== 'cash' && payment.captured - payment.refunded > 0,
  );
  const ranked = [...input.payments].sort((left, right) => {
    const leftCash = left.providerCode === 'cash' ? 1 : 0;
    const rightCash = right.providerCode === 'cash' ? 1 : 0;
    return leftCash - rightCash || left.id - right.id;
  });
  const refunds: EditRefundLeg[] = [];
  let left = surplus;
  for (const payment of ranked) {
    if (left <= 0) break;
    const room = roomOf(payment);
    if (room <= 0) continue;
    const amount = Math.min(room, left);
    left -= amount;
    refunds.push({
      paymentId: payment.id,
      providerCode: payment.providerCode,
      amount,
      settlement: payment.providerCode === 'cash' ? 'settled' : 'pending',
    });
  }
  if (left > 0) {
    throw new OrderingError('REFUND_EXCEEDS_CAPTURED', 'refund exceeds the captured remainder');
  }
  const refundCash = refunds
    .filter((refund) => refund.settlement === 'settled')
    .reduce((sum, refund) => sum + refund.amount, 0);
  const refundTransferPending = refunds
    .filter((refund) => refund.settlement === 'pending')
    .reduce((sum, refund) => sum + refund.amount, 0);
  return {
    paid,
    dueAfter: extraDue,
    refundCash,
    refundTransferPending,
    extraDue,
    paymentLink: extraDue > 0 && capturedOnline,
    refunds,
  };
};

export const editWarnings = (input: {
  subtotal: number;
  minOrderAmount?: number | null;
  keptDiscount: boolean;
}): string[] => {
  const warnings: string[] = [];
  if ((input.minOrderAmount ?? 0) > 0 && input.subtotal < (input.minOrderAmount ?? 0)) {
    warnings.push('below-min-order');
  }
  if (input.keptDiscount) warnings.push('promotion-kept');
  return warnings;
};

export const previewLines = (input: {
  existing: readonly LineAfterReduce[];
  added: readonly AddedPriceLine[];
  priced: ReadonlyArray<{ key: string; lineTotalAmount: number }>;
}): EditPreviewLine[] => {
  const totals = new Map(input.priced.map((line) => [line.key, line.lineTotalAmount]));
  const existing = input.existing.map((line) => ({
    lineId: line.lineId,
    title: line.title,
    quantityBefore: line.quantityBefore,
    quantityAfter: line.quantityAfter,
    lineTotalAfter: totals.get(pricingKeyForLine(line.lineId)) ?? 0,
    added: false,
  }));
  const added = input.added.map((line, index) => ({
    title: line.title,
    quantityBefore: 0,
    quantityAfter: line.quantity,
    lineTotalAfter: totals.get(pricingKeyForAdded(index)) ?? 0,
    added: true,
  }));
  return [...existing, ...added];
};
