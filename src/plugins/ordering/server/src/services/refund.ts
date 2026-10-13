import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import type { Payment as ContractPayment } from '../contracts/payment';
import { businessDate } from '../domain/business-date';
import { OrderingError } from '../domain/errors';
import { amountFromDb, toMoney } from '../domain/money';
import { allocateLargestRemainder } from '../domain/pricing/allocation';
import { refundLineAmount } from '../domain/refund-amount';
import type { TransactionClient } from '../migrations/runner';
import orderRepository from '../repositories/order';
import type { PaymentRow, RefundRow } from '../repositories/types';
import type branchFactory from './branch';
import type changeLogFactory from './change-log';
import type { ServiceContext } from './context';
import { actorRefOf, nowOf } from './context';
import type idempotencyFactory from './idempotency';
import type orderServiceFactory from './order';
import type outboxFactory from './outbox';
import type scopeFactory from './scope';
import type timelineFactory from './timeline';
import type { OrderingRegistry } from './registry';

type Services = {
  registry: OrderingRegistry;
  idempotency: ReturnType<typeof idempotencyFactory>;
  order: ReturnType<typeof orderServiceFactory>;
  timeline: ReturnType<typeof timelineFactory>;
  outbox: ReturnType<typeof outboxFactory>;
  changeLog: ReturnType<typeof changeLogFactory>;
  scope: ReturnType<typeof scopeFactory>;
  branch: ReturnType<typeof branchFactory>;
};

const BANK_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9-]{3,40}$/;

/** Pending refunds already count against a payment's refundable room (same rule as refundBank). */
const pendingRefundSum = async (strapi: Core.Strapi, paymentId: number): Promise<number> => {
  const rows = (await strapi.db
    .connection('plugins_ordering_refund as refund')
    .join('plugins_ordering_refund_payment_lnk as link', 'link.refund_id', 'refund.id')
    .where('link.payment_id', paymentId)
    .where('refund.status', 'pending')
    .select('refund.amount')) as Array<{ amount: string | number }>;
  return rows.reduce((sum, row) => sum + amountFromDb(row.amount), 0);
};

const relationId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = (value as { id: unknown }).id;
    return typeof id === 'number' && Number.isInteger(id) ? id : null;
  }
  return null;
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
 * `refundedAmount` moves only when the provider settles. A pending refund (SePay records the
 * outbound transfer later) reserves the captured remainder and leaves `paymentStatus` unchanged
 * until `settleRefund`.
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
      changeLog: plugin.service('change-log') as Services['changeLog'],
      scope: plugin.service('scope') as Services['scope'],
      branch: plugin.service('branch') as Services['branch'],
    };
  };
  const repo = orderRepository({ strapi });
  const payments = () => strapi.db.query('plugin::ordering.payment');
  const lines = () => strapi.db.query('plugin::ordering.order-line');
  const refunds = () => strapi.db.query('plugin::ordering.refund');
  const refundLines = () => strapi.db.query('plugin::ordering.refund-line');

  /**
   * Business date of a settlement in the order's branch (O6 cash closing sums refunds per
   * collector per business day). Same resolution order as order placement: branch
   * `businessDayPolicy.cutoffLocalTime`, falling back to the configured default.
   */
  const businessDateFor = async (locationRef: string, at: Date): Promise<string> => {
    const { branch } = services();
    const row = await branch.findByCode(locationRef);
    const cutoff =
      branch.pickupSettings(row ?? { fulfillment: null }).schedule.businessDayPolicy
        .cutoffLocalTime ??
      (strapi.config.get('plugin::ordering') as OrderingConfig).businessDay.cutoffLocalTime;
    return businessDate(at, row?.timezone ?? 'Asia/Ho_Chi_Minh', cutoff);
  };

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
    // Pending rows already reserve this payment. The row lock above serializes a second create.
    // Strapi stores the payment relation in a link table, not a column on the refund.
    const pendingRows = (await trx('plugins_ordering_refund as refund')
      .join('plugins_ordering_refund_payment_lnk as link', 'link.refund_id', 'refund.id')
      .where('link.payment_id', input.paymentId)
      .where('refund.status', 'pending')
      .select('refund.amount')) as Array<{ amount: string | number }>;
    const pending = pendingRows.reduce((sum, row) => sum + amountFromDb(row.amount), 0);
    if (total > captured - refunded - pending) {
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
        businessDate:
          settled && orderId !== null
            ? await businessDateFor(aggregate.order.locationRef, nowOf(ctx))
            : null,
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
    // Cash settles in the provider call. SePay stays pending until a person records the
    // outbound reference, so the projection must not move yet.
    if (settled) {
      await payments().update({
        where: { id: input.paymentId },
        data: { refundedAmount: refunded + total },
      });
    }
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

  const referenceOf = (value: unknown): string => {
    if (typeof value !== 'string' || !BANK_REFERENCE.test(value.trim())) {
      throw new OrderingError(
        'VALIDATION_ERROR',
        'bank reference must be 4–41 letters, digits or hyphens',
        { details: { field: 'reference' } },
      );
    }
    return value.trim();
  };

  const settledAtOf = (value: unknown, ctx: ServiceContext): Date => {
    if (value === undefined || value === null || value === '') return nowOf(ctx);
    if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
      throw new OrderingError('VALIDATION_ERROR', 'settledAt is not a valid time', {
        details: { field: 'settledAt' },
      });
    }
    return new Date(value);
  };

  /**
   * POST /refunds/:id/settle. Records the outbound bank reference and, for a refund tied to a
   * payment, moves `refundedAmount` then. The same reference on the same refund is a replay.
   * A refund with no order (review "refund due") is visible only to `allLocations`.
   */
  const settleRefund = async (
    refundId: number,
    input: { reference: unknown; settledAt?: unknown },
    ctx: ServiceContext,
  ): Promise<{ refund: RefundRow; orderId: number | null; replayed: boolean }> => {
    const reference = referenceOf(input.reference);
    const settledAt = settledAtOf(input.settledAt, ctx);
    const { order, timeline, outbox, changeLog, scope } = services();
    return strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
      const locked = await trx('plugins_ordering_refund').where({ id: refundId }).forUpdate().first();
      if (!locked) {
        throw new OrderingError('REFUND_NOT_FOUND', 'refund not found');
      }
      const row = (await refunds().findOne({
        where: { id: refundId },
        populate: { payment: true, order: true },
      })) as RefundRow | null;
      if (!row) {
        throw new OrderingError('REFUND_NOT_FOUND', 'refund not found');
      }
      const orderId = relationId(row.order);
      const paymentId = relationId(row.payment);
      let locationRef: string | undefined;
      if (orderId !== null) {
        const aggregate = await order.getOrder(orderId, ctx);
        locationRef = aggregate.order.locationRef;
      } else {
        const staffScope = await scope.loadScope(ctx);
        if (!staffScope || staffScope.allLocations !== true) {
          throw new OrderingError('REFUND_NOT_FOUND', 'refund not found');
        }
      }
      if (row.status === 'settled' && row.providerReference === reference) {
        return { refund: row, orderId, replayed: true };
      }
      if (row.status !== 'pending') {
        throw new OrderingError('VALIDATION_ERROR', 'refund is already settled', {
          details: { field: 'reference' },
        });
      }
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`refund-ref:${reference}`]);
      const taken = (await refunds().findMany({
        where: { providerReference: reference },
        limit: 2,
      })) as Array<{ id: number }>;
      if (taken.some((other) => other.id !== refundId)) {
        throw new OrderingError('VALIDATION_ERROR', 'bank reference already recorded', {
          details: { field: 'reference' },
        });
      }
      const amount = amountFromDb(row.amount);
      if (paymentId !== null) {
        const paymentLocked = await repo.lockPayment(trx, paymentId);
        if (!paymentLocked) {
          throw new OrderingError('PAYMENT_NOT_FOUND', 'payment not found', {
            details: { paymentId },
          });
        }
        const payment = (await payments().findOne({ where: { id: paymentId } })) as PaymentRow;
        const captured = amountFromDb(payment.capturedAmount);
        const refunded = amountFromDb(payment.refundedAmount);
        if (amount > captured - refunded) {
          throw new OrderingError(
            'REFUND_EXCEEDS_CAPTURED',
            'refund exceeds the captured remainder',
            { details: { paymentId } },
          );
        }
        await payments().update({
          where: { id: paymentId },
          data: { refundedAmount: refunded + amount },
        });
      }
      const updated = (await refunds().update({
        where: { id: refundId },
        data: {
          status: 'settled',
          providerReference: reference,
          settledAt,
          businessDate:
            locationRef !== undefined ? await businessDateFor(locationRef, settledAt) : null,
        },
      })) as RefundRow;
      if (orderId !== null) {
        await order.recomputeProjection(orderId);
        await timeline.record(
          {
            orderId,
            type: 'refund.settled',
            isPublic: true,
            payload: { amount, refundId },
          },
          ctx,
        );
        await outbox.enqueue(
          {
            type: 'refund.settled',
            aggregateType: 'refund',
            aggregateId: String(refundId),
            payload: {
              orderId,
              paymentId,
              refundId,
              amount,
              actorRef: actorRefOf(ctx),
            },
            uniqueKey: `refund.settled:${refundId}`,
          },
          ctx,
        );
      }
      await changeLog.record(
        {
          action: 'refund.settle',
          entityType: 'refund',
          entityId: refundId,
          locationRef,
          orderId: orderId ?? null,
          after: { reference, amount },
        },
        ctx,
      );
      return { refund: updated, orderId, replayed: false };
    });
  };

  return {
    createRefundInTransaction,
    settleRefund,
    pendingRefundSum: (paymentId: number) => pendingRefundSum(strapi, paymentId),

    /**
     * Gives back the money still held when an order closes as canceled (contracts §19.1, §19.8).
     * Cash is refunded now; a captured transfer becomes a refund row the bank provider leaves
     * `pending` until staff settle it. Call it after the close took the group locks: payments are
     * re-read here, so a transfer captured just before the close is not missed. Shared by the
     * admin cancel/reject paths and the O12 auto-reject job. MUST run inside the caller's
     * transaction.
     */
    async refundHeldForOrder(
      trx: TransactionClient,
      orderId: number,
      reason: string,
      ctx: ServiceContext,
    ): Promise<{ refunded: number; refundPending: number }> {
      const payments = (await repo.loadOrderAggregate(orderId))?.payments ?? [];
      let refunded = 0;
      let refundPending = 0;
      for (const payment of payments) {
        const held = payment.capturedAmount - payment.refundedAmount;
        if (held <= 0) continue;
        if (payment.providerCode === 'cash') {
          const { amount } = await createRefundInTransaction(
            trx,
            { paymentId: payment.id, amount: held, reason },
            ctx,
          );
          refunded += amount;
        } else {
          const room = held - (await pendingRefundSum(strapi, payment.id));
          if (room <= 0) continue;
          const { amount, status } = await createRefundInTransaction(
            trx,
            { paymentId: payment.id, amount: room, reason },
            ctx,
          );
          if (status === 'settled') refunded += amount;
          else refundPending += amount;
        }
      }
      return { refunded, refundPending };
    },

    async createRefund(
      input: {
        paymentId: number;
        amount?: number;
        lines?: Array<{ lineId: number; quantity: number }>;
        reason: string;
        idempotencyKey: string;
        /** Written in the same transaction as the refund. A replay does not write it again. */
        audit?: { locationRef?: string; after: Record<string, unknown> };
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

      const { idempotencyKey, audit, ...payload } = input;
      const outcome = await services().idempotency.run(
        { scope: 'refund', key: idempotencyKey, payload },
        ctx,
        async (trx) => {
          const { refund: created, amount, orderId, status } =
            await createRefundInTransaction(trx, { ...input, idempotencyKey }, ctx);
          if (audit) {
            await services().changeLog.record(
              {
                action: 'refund.create',
                entityType: 'refund',
                entityId: created.id as number,
                locationRef: audit.locationRef,
                orderId: orderId ?? null,
                after: audit.after,
              },
              ctx,
            );
          }
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
