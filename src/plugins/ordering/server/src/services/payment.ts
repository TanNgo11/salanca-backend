import type { Core } from '@strapi/strapi';

import type { Order } from '../contracts/entities';
import { OrderingError } from '../domain/errors';
import { amountFromDb, toMoney } from '../domain/money';
import orderRepository from '../repositories/order';
import type { PaymentRow } from '../repositories/types';
import type { ServiceContext } from './context';
import { actorRefOf, nowOf } from './context';
import type orderServiceFactory from './order';
import type outboxFactory from './outbox';
import type timelineFactory from './timeline';
import type { OrderingRegistry } from './registry';

type Services = {
  registry: OrderingRegistry;
  order: ReturnType<typeof orderServiceFactory>;
  timeline: ReturnType<typeof timelineFactory>;
  outbox: ReturnType<typeof outboxFactory>;
};

const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: string }).code === '23505' ||
  (error as { cause?: { code?: string } }).cause?.code === '23505';

const paymentService = ({ strapi }: { strapi: Core.Strapi }) => {
  const services = (): Services => {
    const plugin = strapi.plugin('ordering');
    return {
      registry: plugin.service('registry') as Services['registry'],
      order: plugin.service('order') as Services['order'],
      timeline: plugin.service('timeline') as Services['timeline'],
      outbox: plugin.service('outbox') as Services['outbox'],
    };
  };
  const repo = orderRepository({ strapi });
  const payments = () => strapi.db.query('plugin::ordering.payment');
  const events = () => strapi.db.query('plugin::ordering.payment-event');

  /** The provider contract only names the entity; rows are cast at the boundary. */
  const asContractOrder = (order: unknown): Order => order as Order;

  /** Postgres bigint columns arrive as strings; normalize to safe integers. */
  const normalizePayment = (row: unknown): PaymentRow => {
    const payment = row as PaymentRow & {
      requestedAmount: string | number;
      capturedAmount: string | number;
      refundedAmount: string | number;
    };
    return {
      ...payment,
      requestedAmount: amountFromDb(payment.requestedAmount),
      capturedAmount: amountFromDb(payment.capturedAmount),
      refundedAmount: amountFromDb(payment.refundedAmount),
    };
  };

  return {
    /** Opens a payment intent through the registered provider and records the ledger row. */
    async createPayment(
      input: { orderId: number; providerCode: string; amount?: number },
      ctx: ServiceContext,
    ): Promise<PaymentRow> {
      return strapi.db.transaction(async () => {
        const { registry, order, timeline, outbox } = services();
        const aggregate = await order.getOrder(input.orderId, ctx);
        const captured = aggregate.payments.reduce(
          (sum, payment) => sum + amountFromDb(payment.capturedAmount),
          0,
        );
        const amount = input.amount ?? aggregate.order.totalAmount - captured;
        if (!Number.isSafeInteger(amount) || amount <= 0) {
          throw new OrderingError('VALIDATION_ERROR', 'payment amount must be a positive integer');
        }
        const provider = registry.paymentProvider(input.providerCode);
        const initiation = await provider.initiate({
          // Aggregate rows match the contract field names; ids stay numeric here.
          order: asContractOrder(aggregate.order),
          amount: toMoney(amount, aggregate.order.currency),
        });
        const payment = normalizePayment(await payments().create({
          data: {
            order: input.orderId,
            providerCode: input.providerCode,
            requestedAmount: amount,
            capturedAmount: 0,
            refundedAmount: 0,
            currency: aggregate.order.currency,
            status: initiation.status,
            providerReference: initiation.providerReference ?? null,
            actorRef: actorRefOf(ctx),
            businessDate: aggregate.order.businessDate,
          },
        }));
        await timeline.record(
          {
            orderId: input.orderId,
            type: 'payment.initiated',
            isPublic: true,
            payload: {
              providerCode: input.providerCode,
              amount,
              paymentId: payment.id,
            },
          },
          ctx,
        );
        await outbox.enqueue(
          {
            type: 'payment.initiated',
            aggregateType: 'payment',
            aggregateId: String(payment.id),
            payload: {
              orderId: input.orderId,
              paymentId: payment.id,
              providerCode: input.providerCode,
              amount,
              providerReference: initiation.providerReference,
            },
            uniqueKey: `payment.initiated:${payment.id}`,
          },
          ctx,
        );
        return payment;
      });
    },

    /**
     * Records a provider event (webhook or manual entry). The (providerCode,
     * providerTransactionId) unique index makes delivery idempotent: on a conflict the stored
     * row is returned with `duplicate: true` and the ledger is untouched.
     */
    async recordPaymentEvent(
      input: {
        providerCode: string;
        providerTransactionId: string;
        kind: string;
        amount: number;
        currency?: string;
        transferType?: 'in' | 'out';
        rawPayload?: Record<string, unknown>;
        paymentId?: number;
        reviewStatus?: 'auto-matched' | 'needs-review' | 'matched-manually' | 'refund-due' | 'ignored';
        reviewReason?: string;
        receivedAt?: Date;
      },
      ctx: ServiceContext,
    ): Promise<{ event: unknown; duplicate: boolean }> {
      const create = () =>
        strapi.db.transaction(async () => {
          const { outbox } = services();
          // An event that can't be tied to a payment is parked for staff review — never
          // applied to a ledger.
          const unmatched = input.paymentId == null;
          const event = await events().create({
            data: {
              payment: input.paymentId ?? null,
              providerCode: input.providerCode,
              providerTransactionId: input.providerTransactionId,
              transferType: input.transferType ?? null,
              amount: input.amount,
              currency: input.currency ?? 'VND',
              kind: input.kind,
              rawPayload: input.rawPayload ?? null,
              receivedAt: input.receivedAt ?? nowOf(ctx),
              reviewStatus: input.reviewStatus ?? (unmatched ? 'needs-review' : 'auto-matched'),
              reviewReason: input.reviewReason ?? (unmatched ? 'order-not-found' : null),
            },
          });
          await outbox.enqueue(
            {
              type: 'payment.event.received',
              aggregateType: 'payment-event',
              aggregateId: String(event.id),
              payload: {
                paymentEventId: event.id,
                providerCode: input.providerCode,
                providerTransactionId: input.providerTransactionId,
                kind: input.kind,
                amount: input.amount,
                transferType: input.transferType,
              },
              uniqueKey: `payment-event:${input.providerCode}:${input.providerTransactionId}`,
            },
            ctx,
          );
          return { event, duplicate: false as const };
        });
      try {
        return await create();
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const existing = await events().findOne({
          where: {
            providerCode: input.providerCode,
            providerTransactionId: input.providerTransactionId,
          },
        });
        if (!existing) throw error;
        return { event: existing, duplicate: true };
      }
    },

    /**
     * Captures money against a payment. The event row is written in the same transaction as
     * the ledger update; a replayed providerTransactionId is a duplicate and changes nothing.
     */
    async capturePayment(
      input: {
        paymentId: number;
        amount: number;
        providerTransactionId: string;
        rawPayload?: Record<string, unknown>;
      },
      ctx: ServiceContext,
    ): Promise<{ payment: PaymentRow; duplicate: boolean }> {
      const capture = () =>
        strapi.db.transaction(async ({ trx }) => {
          const { order, timeline, outbox } = services();
          const locked = await repo.lockPayment(trx, input.paymentId);
          if (!locked) {
            throw new OrderingError('PAYMENT_NOT_FOUND', 'payment not found', {
              details: { paymentId: input.paymentId },
            });
          }
          // `order` lives in a link table — populate it to recover the order id.
          const payment = normalizePayment(
            await payments().findOne({
              where: { id: input.paymentId },
              populate: { order: { columns: ['id'] } },
            }),
          );
          const orderId =
            typeof payment.order === 'object' && payment.order !== null
              ? (payment.order as unknown as { id: number }).id
              : (payment.order as number);
          const aggregate = await order.getOrder(orderId, ctx);

          const event = await events().create({
            data: {
              payment: input.paymentId,
              providerCode: payment.providerCode,
              providerTransactionId: input.providerTransactionId,
              transferType: 'in',
              amount: input.amount,
              currency: payment.currency,
              kind: 'capture',
              rawPayload: input.rawPayload ?? null,
              receivedAt: nowOf(ctx),
              reviewStatus: 'auto-matched',
            },
          });
          const capturedAmount = payment.capturedAmount + input.amount;
          const status = capturedAmount >= payment.requestedAmount ? 'captured' : 'pending';
          await payments().update({
            where: { id: input.paymentId },
            data: {
              capturedAmount,
              status,
              capturedAt: nowOf(ctx),
              businessDate: aggregate.order.businessDate,
              actorRef: actorRefOf(ctx),
            },
          });
          const projection = await order.recomputeProjection(orderId);
          await timeline.record(
            {
              orderId,
              type: 'payment.captured',
              isPublic: true,
              payload: {
                providerCode: payment.providerCode,
                amount: input.amount,
                paymentId: input.paymentId,
              },
            },
            ctx,
          );
          await outbox.enqueue(
            {
              type: 'payment.captured',
              aggregateType: 'payment',
              aggregateId: String(input.paymentId),
              payload: {
                orderId,
                paymentId: input.paymentId,
                capturedAmount,
                providerReference: payment.providerReference,
              },
              uniqueKey: `payment.captured:${event.id}`,
            },
            ctx,
          );
          if (projection.before.status !== projection.after.status) {
            await outbox.enqueue(
              {
                type: 'order.transitioned',
                aggregateType: 'order',
                aggregateId: String(orderId),
                payload: {
                  orderId,
                  from: projection.before.status,
                  to: projection.after.status,
                  actorRef: actorRefOf(ctx),
                },
                uniqueKey: `order.transitioned:${orderId}:${input.providerTransactionId}`,
              },
              ctx,
            );
          }
          const updated = normalizePayment(
            await payments().findOne({ where: { id: input.paymentId } }),
          );
          return { payment: updated, duplicate: false as const };
        });
      try {
        return await capture();
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const row = await payments().findOne({ where: { id: input.paymentId } });
        if (!row) throw error;
        return { payment: normalizePayment(row), duplicate: true };
      }
    },
  };
};

export default paymentService;
