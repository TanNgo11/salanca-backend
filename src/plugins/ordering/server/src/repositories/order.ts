import type { Core } from '@strapi/strapi';

import { amountFromDb } from '../domain/money';
import type { TransactionClient } from '../migrations/runner';
import type {
  AdjustmentRow,
  FulfillmentGroupRow,
  HoldRow,
  OrderAggregate,
  OrderLineRow,
  OrderRow,
  PaymentRow,
  RefundRow,
} from './types';

const MONEY_ORDER = [
  'subtotalAmount',
  'adjustmentAmount',
  'fulfillmentAmount',
  'taxAmount',
  'totalAmount',
] as const;
const MONEY_LINE = [
  'unitAmount',
  'optionAmount',
  'baseAmount',
  'discountAmount',
  'feeAmount',
  'roundingDelta',
  'taxAmount',
  'lineTotalAmount',
] as const;
const MONEY_PAYMENT = ['requestedAmount', 'capturedAmount', 'refundedAmount'] as const;

type RawRow = Record<string, unknown>;

const convert = <T>(row: RawRow, fields: readonly string[]): T => {
  const out: RawRow = { ...row };
  for (const field of fields) {
    out[field] = amountFromDb(row[field] as string | number | bigint | null | undefined);
  }
  return out as T;
};

/**
 * Persistence layer for the order aggregate. Every method uses `strapi.db.query`, so calls
 * inside `strapi.db.transaction` automatically join the caller's transaction (AsyncLocalStorage);
 * `trx` is only touched for row locks and the order-code sequence (raw SQL).
 */
const orderRepository = ({ strapi }: { strapi: Core.Strapi }) => {
  const orders = () => strapi.db.query('plugin::ordering.order');

  const mapAggregate = (row: RawRow): OrderAggregate => ({
    order: convert<OrderRow>(row, MONEY_ORDER),
    lines: ((row.lines as RawRow[]) ?? []).map((line) => convert<OrderLineRow>(line, MONEY_LINE)),
    groups: ((row.fulfillmentGroups as RawRow[]) ?? []).map((group) =>
      convert<FulfillmentGroupRow>(group, ['fulfillmentAmount']),
    ),
    adjustments: ((row.adjustments as RawRow[]) ?? []).map((adjustment) => ({
      ...convert<AdjustmentRow>(adjustment, ['amount']),
      allocations: ((adjustment.allocations as RawRow[]) ?? []).map((allocation) =>
        convert<{ id: number; line: number | null; weight: number; amount: number }>(allocation, [
          'weight',
          'amount',
        ]),
      ),
    })),
    payments: ((row.payments as RawRow[]) ?? []).map((payment) =>
      convert<PaymentRow>(payment, MONEY_PAYMENT),
    ),
    refunds: ((row.refunds as RawRow[]) ?? []).map((refund) => ({
      ...convert<RefundRow>(refund, ['amount']),
      lines: ((refund.lines as RawRow[]) ?? []).map((line) =>
        convert<{ id: number; line: number | null; quantity: number; amount: number }>(line, [
          'amount',
        ]),
      ),
    })),
    holds: ((row.holds as HoldRow[]) ?? []).map((hold) => ({ ...hold })),
  });

  return {
    async findOrderById(id: number, options?: { populate?: unknown }): Promise<OrderRow | null> {
      const row = await orders().findOne({ where: { id }, populate: options?.populate });
      return row ? convert<OrderRow>(row, MONEY_ORDER) : null;
    },

    /** Loads the full aggregate; bigint columns are returned as safe-integer numbers. */
    async loadOrderAggregate(id: number): Promise<OrderAggregate | null> {
      const row = await orders().findOne({
        where: { id },
        populate: {
          lines: { orderBy: { position: 'asc' } },
          fulfillmentGroups: true,
          adjustments: { populate: { allocations: true } },
          payments: true,
          refunds: { populate: { lines: true } },
          holds: true,
        },
      });
      return row ? mapAggregate(row) : null;
    },

    async updateOrder(id: number, data: Record<string, unknown>): Promise<void> {
      await orders().update({ where: { id }, data });
    },

    async lockGroup(trx: TransactionClient, groupId: number): Promise<RawRow | undefined> {
      return trx('plugins_ordering_fulfillment_group').where({ id: groupId }).forUpdate().first();
    },

    async lockLine(trx: TransactionClient, lineId: number): Promise<RawRow | undefined> {
      return trx('plugins_ordering_order_line').where({ id: lineId }).forUpdate().first();
    },

    async lockPayment(trx: TransactionClient, paymentId: number): Promise<RawRow | undefined> {
      return trx('plugins_ordering_payment').where({ id: paymentId }).forUpdate().first();
    },

    /** Draws the next order-code sequence value. Never gaps backwards across rollbacks. */
    async nextOrderSequence(trx: TransactionClient): Promise<number> {
      const { rows } = await trx.raw(
        `SELECT nextval('plugins_ordering_order_code_seq') AS seq`,
      );
      return Number(rows[0].seq);
    },
  };
};

export default orderRepository;
