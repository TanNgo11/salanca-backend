import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import { amountFromDb, sumAmounts } from '../domain/money';
import { cumulativeRefundedAmount } from '../domain/refund-amount';
import type { TransactionClient } from '../migrations/runner';
import orderRepository from '../repositories/order';
import type { OrderAggregate } from '../repositories/types';
import type { ServiceContext } from './context';
import { actorRefOf } from './context';
import type orderServiceFactory from './order';
import type outboxFactory from './outbox';
import type refundFactory from './refund';
import type timelineFactory from './timeline';

type Services = {
  order: ReturnType<typeof orderServiceFactory>;
  refund: ReturnType<typeof refundFactory>;
  timeline: ReturnType<typeof timelineFactory>;
  outbox: ReturnType<typeof outboxFactory>;
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
 * whether or not money was captured; when captured funds remain, the matching telescoped
 * amount is refunded through the refund core with `countsAs: 'canceled'` (so no quantity
 * column is bumped twice). The order's `totalAmount` is immutable — the refund is the
 * money-back record. The fulfillment group is NOT auto-transitioned: staff close the group
 * explicitly so partially-canceled orders keep moving through the kitchen.
 */
const lineCancel = ({ strapi }: { strapi: Core.Strapi }) => {
  const services = (): Services => {
    const plugin = strapi.plugin('ordering');
    return {
      order: plugin.service('order') as Services['order'],
      refund: plugin.service('refund') as Services['refund'],
      timeline: plugin.service('timeline') as Services['timeline'],
      outbox: plugin.service('outbox') as Services['outbox'],
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
        const orderPayments = (await payments().findMany({
          where: { order: input.orderId },
        })) as Array<{ id: number; capturedAmount: string | number; refundedAmount: string | number }>;
        const candidates = orderPayments
          .map((payment) => ({
            id: payment.id,
            remaining: amountFromDb(payment.capturedAmount) - amountFromDb(payment.refundedAmount),
          }))
          .filter((payment) => payment.remaining > 0)
          .sort((a, b) => b.remaining - a.remaining);
        const cap = Math.min(due, sumAmounts(candidates.map((payment) => payment.remaining)));
        let refundAmount = 0;
        if (cap > 0 && candidates[0]) {
          const { amount } = await refund.createRefundInTransaction(
            trx,
            {
              paymentId: candidates[0].id,
              lines: [{ lineId: input.lineId, quantity: input.quantity }],
              countsAs: 'canceled',
              amountCap: cap,
              reason: input.reason,
              idempotencyKey: `line-cancel:${input.lineId}:${randomUUID()}`,
            },
            ctx,
          );
          refundAmount = amount;
        }
        const refundShortfall = due - refundAmount;

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
