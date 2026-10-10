import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { Payment as ContractPayment } from '../contracts/payment';
import { OrderingError } from '../domain/errors';
import { amountFromDb, toMoney } from '../domain/money';
import { allocateLargestRemainder } from '../domain/pricing/allocation';
import { refundLineAmount } from '../domain/refund-amount';
import type { TransactionClient } from '../migrations/runner';
import orderRepository from '../repositories/order';
import type { PaymentRow, RefundRow } from '../repositories/types';
import type { ServiceContext } from './context';
import { actorRefOf, nowOf } from './context';
import type idempotencyFactory from './idempotency';
import type orderServiceFactory from './order';
import type outboxFactory from './outbox';
import type timelineFactory from './timeline';
import type { OrderingRegistry } from './registry';

type Services = {
  registry: OrderingRegistry;
  idempotency: ReturnType<typeof idempotencyFactory>;
  order: ReturnType<typeof orderServiceFactory>;
  timeline: ReturnType<typeof timelineFactory>;
  outbox: ReturnType<typeof outboxFactory>;
};

type LineRow = {
  id: number;
  quantity: number;
  returnedQuantity: number;
  canceledQuantity: number;
  lineTotalAmount: string | number;
};

export type RefundCoreInput = {
  paymentId: number;
  amount?: number;
  lines?: Array<{ lineId: number; quantity: number }>;
  /**
   * `returned` (default): the refunded units move into `returnedQuantity`. `canceled`: the
   * caller already moved the units into `canceledQuantity` — the refund only attaches money,
   * no quantity column is bumped and the telescoping baseline is the pre-cancel value.
   */
  countsAs?: 'returned' | 'canceled';
  /** Internal-only cap (line-cancel): refund at most this much even when the lines telescope higher. */
  amountCap?: number;
  reason: string;
  idempotencyKey?: string;
};

export type CreateRefundResult = {
  refund: Record<string, unknown>;
  replayed: boolean;
};

/**
 * Line-aware refunds. Per-line amounts use the telescoping cumulative rule from
 * `domain/refund-amount` so any split of refunds over a line returns exactly
 * `lineTotalAmount`; a refund may never exceed `captured − refunded` on its payment.
 * The public `createRefund` wraps the transaction core in the `refund` idempotency scope —
 * a replayed key returns the stored snapshot. `createRefundInTransaction` is the
 * idempotency-free core other services (line-cancel) compose inside their own transaction.
 */
const refund = ({ strapi }: { strapi: Core.Strapi }) => {
  const services = (): Services => {
    const plugin = strapi.plugin('ordering');
    return {
      registry: plugin.service('registry') as Services['registry'],
      idempotency: plugin.service('idempotency') as Services['idempotency'],
      order: plugin.service('order') as Services['order'],
      timeline: plugin.service('timeline') as Services['timeline'],
      outbox: plugin.service('outbox') as Services['outbox'],
    };
  };
  const repo = orderRepository({ strapi });
  const payments = () => strapi.db.query('plugin::ordering.payment');
  const lines = () => strapi.db.query('plugin::ordering.order-line');
  const refunds = () => strapi.db.query('plugin::ordering.refund');
  const refundLines = () => strapi.db.query('plugin::ordering.refund-line');

  /** The idempotency-free core; MUST run inside the caller's transaction. */
  const createRefundInTransaction = async (
    trx: TransactionClient,
    input: RefundCoreInput,
    ctx: ServiceContext,
  ): Promise<{ refund: RefundRow; amount: number; orderId: number; status: string }> => {
    const { registry, order, timeline, outbox } = services();
    const countsAs = input.countsAs ?? 'returned';
    const locked = await repo.lockPayment(trx, input.paymentId);
    if (!locked) {
      throw new OrderingError('PAYMENT_NOT_FOUND', 'payment not found', {
        details: { paymentId: input.paymentId },
      });
    }
    // `order` lives in a link table — populate it to recover the order id.
    const payment = (await payments().findOne({
      where: { id: input.paymentId },
      populate: { order: { columns: ['id'] } },
    })) as PaymentRow;
    const rawOrder = (payment as { order: unknown }).order;
    const orderId =
      typeof rawOrder === 'object' && rawOrder !== null
        ? (rawOrder as { id: number }).id
        : Number(rawOrder);
    const aggregate = await order.getOrder(orderId, ctx); // scope check inside
    const currency = payment.currency;

    const lineRefunds: Array<{ lineId: number; quantity: number; amount: number }> = [];
    let total: number;
    if (input.lines) {
      let sum = 0;
      for (const requested of input.lines) {
        await repo.lockLine(trx, requested.lineId);
        const line = (await lines().findOne({
          where: { id: requested.lineId },
        })) as LineRow | null;
        if (!line || aggregate.lines.every((l) => l.id !== line.id)) {
          throw new OrderingError('REFUND_LINE_INVALID', 'line does not belong to the order', {
            details: { lineId: requested.lineId },
          });
        }
        const lineTotal = amountFromDb(line.lineTotalAmount);
        let k0: number;
        if (countsAs === 'canceled') {
          // Caller already bumped canceledQuantity; the telescoping baseline is the value
          // before this refund's units were moved.
          k0 = line.returnedQuantity + line.canceledQuantity - requested.quantity;
          if (
            !Number.isInteger(requested.quantity) ||
            requested.quantity <= 0 ||
            k0 < 0
          ) {
            throw new OrderingError('REFUND_LINE_INVALID', 'refund quantity exceeds the line', {
              details: { lineId: line.id },
            });
          }
        } else {
          const refundable =
            line.quantity - line.returnedQuantity - line.canceledQuantity;
          if (
            !Number.isInteger(requested.quantity) ||
            requested.quantity <= 0 ||
            requested.quantity > refundable
          ) {
            throw new OrderingError('REFUND_LINE_INVALID', 'refund quantity exceeds the line', {
              details: { lineId: line.id, refundable },
            });
          }
          k0 = line.returnedQuantity + line.canceledQuantity;
          await lines().update({
            where: { id: line.id },
            data: { returnedQuantity: line.returnedQuantity + requested.quantity },
          });
        }
        const amount = refundLineAmount(lineTotal, line.quantity, k0, requested.quantity);
        sum += amount;
        lineRefunds.push({ lineId: line.id, quantity: requested.quantity, amount });
      }
      total = sum;
    } else {
      total = input.amount as number;
    }

    // Internal cap (line-cancel with partial capture): shrink the refund to the cap, keeping
    // Σ refund-line amounts == refund.amount via largest-remainder re-allocation.
    if (input.amountCap !== undefined && total > input.amountCap) {
      if (lineRefunds.length > 0) {
        const shares = allocateLargestRemainder(
          input.amountCap,
          lineRefunds.map((line) => line.amount),
        );
        lineRefunds.forEach((line, index) => {
          line.amount = shares[index];
        });
      }
      total = input.amountCap;
    }

    const captured = amountFromDb(payment.capturedAmount);
    const refunded = amountFromDb(payment.refundedAmount);
    if (total > captured - refunded) {
      throw new OrderingError(
        'REFUND_EXCEEDS_CAPTURED',
        'refund exceeds the captured remainder',
        { details: { paymentId: input.paymentId } },
      );
    }

    const provider = registry.paymentProvider(payment.providerCode);
    if (!provider.refund) {
      throw new OrderingError('PROVIDER_NOT_REGISTERED', 'provider cannot refund', {
        details: { providerCode: payment.providerCode },
      });
    }
    const result = await provider.refund({
      payment: payment as unknown as ContractPayment,
      amount: toMoney(total, currency),
      reason: input.reason,
      idempotencyKey: input.idempotencyKey ?? `refund:${input.paymentId}:${randomUUID()}`,
    });

    const settled = result.status === 'settled';
    const created = await refunds().create({
      data: {
        payment: input.paymentId,
        order: orderId,
        amount: total,
        currency,
        reason: input.reason,
        actorRef: actorRefOf(ctx),
        idempotencyKey: input.idempotencyKey ?? null,
        providerReference: result.providerReference ?? null,
        status: result.status,
        settledAt: settled ? nowOf(ctx) : null,
      },
    });
    for (const lineRefund of lineRefunds) {
      await refundLines().create({
        data: {
          refund: created.id,
          line: lineRefund.lineId,
          quantity: lineRefund.quantity,
          amount: lineRefund.amount,
        },
      });
    }
    await payments().update({
      where: { id: input.paymentId },
      data: { refundedAmount: refunded + total },
    });
    // Refunds only move paymentStatus; the order status itself is unchanged.
    await order.recomputeProjection(orderId);
    const eventType = `refund.${result.status}`;
    await timeline.record(
      {
        orderId,
        type: eventType,
        isPublic: true,
        payload: {
          amount: total,
          refundId: created.id,
          lineIds: lineRefunds.map((line) => line.lineId),
        },
      },
      ctx,
    );
    await outbox.enqueue(
      {
        type: eventType,
        aggregateType: 'refund',
        aggregateId: String(created.id),
        payload: {
          orderId,
          paymentId: input.paymentId,
          refundId: created.id,
          amount: total,
          actorRef: actorRefOf(ctx),
        },
        uniqueKey: `${eventType}:${created.id}`,
      },
      ctx,
    );
    return { refund: created as RefundRow, amount: total, orderId, status: result.status };
  };

  return {
    createRefundInTransaction,

    async createRefund(
      input: {
        paymentId: number;
        amount?: number;
        lines?: Array<{ lineId: number; quantity: number }>;
        reason: string;
        idempotencyKey: string;
      },
      ctx: ServiceContext,
    ): Promise<CreateRefundResult> {
      if (input.lines && input.amount !== undefined) {
        throw new OrderingError(
          'VALIDATION_ERROR',
          'amount must not be set when refunding by lines',
        );
      }
      if (!input.lines && (!Number.isSafeInteger(input.amount) || (input.amount ?? 0) <= 0)) {
        throw new OrderingError('VALIDATION_ERROR', 'refund amount must be a positive integer');
      }
      if (!input.reason?.trim()) {
        throw new OrderingError('VALIDATION_ERROR', 'refund reason is required');
      }

      const { idempotencyKey, ...payload } = input;
      const outcome = await services().idempotency.run(
        { scope: 'refund', key: idempotencyKey, payload },
        ctx,
        async (trx) => {
          const { refund: created, amount, orderId, status } =
            await createRefundInTransaction(trx, { ...input, idempotencyKey }, ctx);
          return {
            result: { refundId: created.id as number },
            responseRef: `refund:${created.id}`,
            responseSnapshot: {
              refundId: created.id,
              orderId,
              paymentId: input.paymentId,
              amount,
              status,
            },
          };
        },
      );

      if (outcome.replayed) {
        const refundId = Number(outcome.result.refundId);
        const row = await refunds().findOne({ where: { id: refundId } });
        if (!row) {
          throw new OrderingError('INTERNAL', 'idempotent replay lost the stored refund');
        }
        return { refund: row, replayed: true };
      }
      const row = await refunds().findOne({ where: { id: outcome.result.refundId } });
      return { refund: row, replayed: false };
    },
  };
};

export default refund;
