import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import { amountFromDb, sumAmounts } from '../domain/money';
import { removedLineAmount } from '../domain/payable';
import { cumulativeRefundedAmount } from '../domain/refund-amount';
import type { TransactionClient } from '../migrations/runner';
import orderRepository from '../repositories/order';
import type { OrderAggregate } from '../repositories/types';
import type { ServiceContext } from './context';
import { actorRefOf } from './context';
import type dailyStockFactory from './daily-stock';
import type orderServiceFactory from './order';
import type outboxFactory from './outbox';
import type refundFactory from './refund';
import type timelineFactory from './timeline';

type Services = {
  order: ReturnType<typeof orderServiceFactory>;
  refund: ReturnType<typeof refundFactory>;
  timeline: ReturnType<typeof timelineFactory>;
  outbox: ReturnType<typeof outboxFactory>;
  dailyStock: ReturnType<typeof dailyStockFactory>;
};

type LineRow = {
  id: number;
  quantity: number;
  fulfilledQuantity: number;
  returnedQuantity: number;
  canceledQuantity: number;
  lineTotalAmount: string | number;
};

/**
 * Cancels units of one order line ("hủy một phần món"). The units land in `canceledQuantity`
 * whether or not money was captured, and their telescoped share leaves what the customer still
 * owes (`domain/payable`). Only money held above that owed amount goes back, through the refund
 * core with `countsAs: 'canceled'` (so no quantity column is bumped twice): an unpaid or
 * part-paid order refunds nothing, a fully paid one gets the share back. Pending refunds already
 * reserve captured money, so they shrink what can be refunded now; `refundShortfall` records the
 * part that should go back but is reserved. Cash settles inside the refund. A bank transfer stays
 * pending until its reference is recorded. The order's `totalAmount` is immutable.
 * The fulfillment group is NOT auto-transitioned: staff close the group explicitly so
 * partially-canceled orders keep moving through the kitchen.
 */
const lineCancel = ({ strapi }: { strapi: Core.Strapi }) => {
  const services = (): Services => {
    const plugin = strapi.plugin('ordering');
    return {
      order: plugin.service('order') as Services['order'],
      refund: plugin.service('refund') as Services['refund'],
      timeline: plugin.service('timeline') as Services['timeline'],
      outbox: plugin.service('outbox') as Services['outbox'],
      dailyStock: plugin.service('daily-stock') as Services['dailyStock'],
    };
  };
  const repo = orderRepository({ strapi });
  const lines = () => strapi.db.query('plugin::ordering.order-line');
  const payments = () => strapi.db.query('plugin::ordering.payment');

  return {
    async cancelLineQuantity(
      input: { orderId: number; lineId: number; quantity: number; reason: string },
      ctx: ServiceContext,
    ): Promise<{ order: OrderAggregate; refundAmount: number; refundShortfall: number }> {
      if (!input.reason?.trim()) {
        throw new OrderingError('VALIDATION_ERROR', 'cancel reason is required');
      }
      if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
        throw new OrderingError('VALIDATION_ERROR', 'quantity must be a positive integer');
      }
      return strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
        const { order, refund, timeline, outbox } = services();
        const aggregate = await order.getOrder(input.orderId, ctx); // scope check inside
        if (!aggregate.lines.some((line) => line.id === input.lineId)) {
          throw new OrderingError('LINE_INVALID', 'line does not belong to the order', {
            details: { lineId: input.lineId },
          });
        }
        await repo.lockLine(trx, input.lineId);
        const line = (await lines().findOne({ where: { id: input.lineId } })) as LineRow;
        const committed =
          line.fulfilledQuantity + line.returnedQuantity + line.canceledQuantity;
        if (committed + input.quantity > line.quantity) {
          throw new OrderingError(
            'LINE_QUANTITY_EXCEEDED',
            'cancel quantity exceeds the line remainder',
            {
              details: {
                lineId: input.lineId,
                remaining: line.quantity - committed,
              },
            },
          );
        }
        await lines().update({
          where: { id: line.id },
          data: { canceledQuantity: line.canceledQuantity + input.quantity },
        });
        await services().dailyStock.releaseForLine(trx, input.lineId, input.quantity);

        // Telescoped amount for the units just moved to canceled.
        const due =
          cumulativeRefundedAmount(
            amountFromDb(line.lineTotalAmount),
            line.quantity,
            line.returnedQuantity + line.canceledQuantity + input.quantity,
          ) -
          cumulativeRefundedAmount(
            amountFromDb(line.lineTotalAmount),
            line.quantity,
            line.returnedQuantity + line.canceledQuantity,
          );

        // Refund against the payment with the largest captured remainder, capped at it.
        // Pending rows already reserve that remainder (refund.ts checks the same sum).
        const orderPayments = (await payments().findMany({
          where: { order: input.orderId },
        })) as Array<{
          id: number;
          providerCode: string;
          capturedAmount: string | number;
          refundedAmount: string | number;
        }>;
        const pendingByPayment = new Map<number, number>();
        if (orderPayments.length > 0) {
          const pendingRows = (await trx('plugins_ordering_refund as refund')
            .join('plugins_ordering_refund_payment_lnk as link', 'link.refund_id', 'refund.id')
            .whereIn(
              'link.payment_id',
              orderPayments.map((payment) => payment.id),
            )
            .where('refund.status', 'pending')
            .select('link.payment_id', 'refund.amount')) as Array<{
            payment_id: number;
            amount: string | number;
          }>;
          for (const row of pendingRows) {
            const id = Number(row.payment_id);
            pendingByPayment.set(id, (pendingByPayment.get(id) ?? 0) + amountFromDb(row.amount));
          }
        }
        const candidates = orderPayments
          .map((payment) => ({
            id: payment.id,
            // O9: value returns to the card before cash/bank (spec "hoàn về thẻ trước").
            giftCard: payment.providerCode === 'gift-card',
            remaining:
              amountFromDb(payment.capturedAmount) -
              amountFromDb(payment.refundedAmount) -
              (pendingByPayment.get(payment.id) ?? 0),
          }))
          .filter((payment) => payment.remaining > 0)
          .sort(
            (a, b) => Number(b.giftCard) - Number(a.giftCard) || b.remaining - a.remaining,
          );
        // Only money held above what is still owed goes back: an unpaid or part-paid order has
        // nothing to refund (the canceled share just leaves `due`), a fully paid one gets the
        // share back. Units already returned or canceled count as gone, settled refunds as given.
        const orderLines = (await lines().findMany({
          where: { order: input.orderId },
          select: ['quantity', 'returnedQuantity', 'canceledQuantity', 'lineTotalAmount'],
        })) as Array<Pick<LineRow, 'quantity' | 'returnedQuantity' | 'canceledQuantity'> & {
          lineTotalAmount: string | number;
        }>;
        const stillOwed = Math.max(
          0,
          aggregate.order.totalAmount -
            removedLineAmount(
              orderLines.map((row) => ({ ...row, lineTotalAmount: amountFromDb(row.lineTotalAmount) })),
            ),
        );
        const heldSettled = sumAmounts(
          orderPayments.map(
            (payment) => amountFromDb(payment.capturedAmount) - amountFromDb(payment.refundedAmount),
          ),
        );
        const owedBack = Math.min(due, Math.max(0, heldSettled - stillOwed));
        // Split across payments in that order (card first), each slice capped at its own
        // remainder — a card that paid part of the order must not take the whole line refund.
        // Every slice carries the line so its refund-line rows exist; their quantities repeat
        // per slice (nothing reads refund-line quantities, the amounts sum to the refund).
        let left = Math.min(owedBack, sumAmounts(candidates.map((payment) => payment.remaining)));
        let refundAmount = 0;
        for (const candidate of candidates) {
          if (left <= 0) break;
          const slice = Math.min(candidate.remaining, left);
          const { amount } = await refund.createRefundInTransaction(
            trx,
            {
              paymentId: candidate.id,
              lines: [{ lineId: input.lineId, quantity: input.quantity }],
              countsAs: 'canceled',
              amountCap: slice,
              reason: input.reason,
              idempotencyKey: `line-cancel:${input.lineId}:${randomUUID()}`,
            },
            ctx,
          );
          refundAmount += amount;
          left -= amount;
        }
        // Money that should go back but is already reserved by pending refunds.
        const refundShortfall = owedBack - refundAmount;

        await timeline.record(
          {
            orderId: input.orderId,
            type: 'order.line.canceled',
            isPublic: true,
            payload: {
              lineId: input.lineId,
              quantity: input.quantity,
              amount: due,
              reason: input.reason,
              ...(refundShortfall > 0 ? { refundShortfall } : {}),
            },
          },
          ctx,
        );
        await outbox.enqueue(
          {
            type: 'order.line.canceled',
            aggregateType: 'order',
            aggregateId: String(input.orderId),
            payload: {
              orderId: input.orderId,
              lineId: input.lineId,
              quantity: input.quantity,
              amount: due,
              actorRef: actorRefOf(ctx),
            },
            uniqueKey: `order.line.canceled:${input.lineId}:${randomUUID()}`,
          },
          ctx,
        );
        await order.recomputeProjection(input.orderId);
        const updated = await repo.loadOrderAggregate(input.orderId);
        return { order: updated as OrderAggregate, refundAmount, refundShortfall };
      });
    },
  };
};

export default lineCancel;
