import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import type { NormalizedPaymentEvent } from '../contracts/payment';
import type { WorkflowDefinition } from '../contracts/workflow';
import { OrderingError } from '../domain/errors';
import { amountFromDb } from '../domain/money';
import { matchTransfer, type MatchDecision } from '../domain/payments/match';
import { extractOrderCode } from '../domain/payments/memo';
import type { TransactionClient } from '../migrations/runner';
import { accountScope, type SepaySettings } from '../providers/sepay/config';
import { sepaySettingsFromConfig } from '../providers/sepay/provider';
import orderRepository from '../repositories/order';
import type { OrderAggregate, PaymentRow } from '../repositories/types';
import type { ServiceContext } from './context';
import { actorRefOf, nowOf } from './context';
import type orderServiceFactory from './order';
import type outboxFactory from './outbox';
import type timelineFactory from './timeline';
import type transitionFactory from './transition';
import type { OrderingRegistry } from './registry';

type Services = {
  registry: OrderingRegistry;
  order: ReturnType<typeof orderServiceFactory>;
  timeline: ReturnType<typeof timelineFactory>;
  outbox: ReturnType<typeof outboxFactory>;
  transition: ReturnType<typeof transitionFactory>;
};

const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: string }).code === '23505' ||
  (error as { cause?: { code?: string } }).cause?.code === '23505';

/** The non-terminal edge out of `awaiting-payment` (acceptance, or start preparing). */
const paymentSuccessState = (definition: WorkflowDefinition): string | null => {
  const next = definition.states['awaiting-payment']?.next ?? [];
  return next.find((state) => state !== 'expired' && state !== definition.cancelState) ?? null;
};

/**
 * Applies a SePay transfer (contracts §19.1). The payment-event row and the ledger move in
 * one transaction; a replay of the same provider id rolls the second attempt back. A review
 * decision stores the event and does not change the order. An underpayment stays unpaid
 * until staff assign it; a later coded transfer for the remainder then matches on its own.
 */
const paymentMatching = ({ strapi }: { strapi: Core.Strapi }) => {
  const services = (): Services => {
    const plugin = strapi.plugin('ordering');
    return {
      registry: plugin.service('registry') as Services['registry'],
      order: plugin.service('order') as Services['order'],
      timeline: plugin.service('timeline') as Services['timeline'],
      outbox: plugin.service('outbox') as Services['outbox'],
      transition: plugin.service('transition') as Services['transition'],
    };
  };
  const repo = orderRepository({ strapi });
  const events = () => strapi.db.query('plugin::ordering.payment-event');
  const payments = () => strapi.db.query('plugin::ordering.payment');
  const orders = () => strapi.db.query('plugin::ordering.order');
  const settingsOf = (): SepaySettings | null =>
    sepaySettingsFromConfig((strapi.config.get('plugin::ordering') as OrderingConfig).providers.payment);

  const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

  /**
   * A staff manual row is confirmed by the SePay id. Existing keys stay; the webhook body
   * (sender, account, raw content) is not copied onto the row.
   */
  const confirmManualRow = async (
    row: { id: number; rawPayload: unknown },
    sepayTransactionId: string,
    ctx: ServiceContext,
  ) => {
    const raw =
      row.rawPayload !== null && typeof row.rawPayload === 'object' && !Array.isArray(row.rawPayload)
        ? (row.rawPayload as Record<string, unknown>)
        : {};
    if (raw.confirmed === true) return;
    const transferredAt = typeof raw.transferredAt === 'string' ? raw.transferredAt : undefined;
    await events().update({
      where: { id: row.id },
      data: {
        rawPayload: {
          manual: true,
          confirmed: true,
          confirmedAt: nowOf(ctx).toISOString(),
          ...(transferredAt ? { transferredAt } : {}),
          sepayTransactionId,
        },
      },
    });
  };

  const insertEvent = async (
    input: {
      providerCode: string;
      providerTransactionId: string;
      kind: string;
      amount: number;
      currency: string;
      transferType?: 'in' | 'out';
      rawPayload: Record<string, unknown> | null;
      paymentId?: number | null;
      reviewStatus: 'auto-matched' | 'needs-review' | 'matched-manually' | 'refund-due' | 'ignored';
      reviewReason?: string | null;
    },
    ctx: ServiceContext,
  ) => {
    const { outbox } = services();
    const event = await events().create({
      data: {
        payment: input.paymentId ?? null,
        providerCode: input.providerCode,
        providerTransactionId: input.providerTransactionId,
        transferType: input.transferType ?? null,
        amount: input.amount,
        currency: input.currency,
        kind: input.kind,
        rawPayload: input.rawPayload,
        receivedAt: nowOf(ctx),
        reviewStatus: input.reviewStatus,
        reviewReason: input.reviewReason ?? null,
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
    return event as { id: number };
  };

  const lockGroups = async (trx: TransactionClient, aggregate: OrderAggregate) => {
    for (const group of [...aggregate.groups].sort((a, b) => a.id - b.id)) {
      await repo.lockGroup(trx, group.id);
    }
  };

  /** Adds `amount` onto the order's SePay payment, creating the row when this is the first transfer. */
  const addCapture = async (
    input: { orderId: number; amount: number; currency: string; businessDate: string | null; settles: boolean },
    ctx: ServiceContext,
  ): Promise<PaymentRow> => {
    const existing = (await payments().findMany({
      where: { order: input.orderId, providerCode: 'sepay' },
    })) as Array<PaymentRow & { requestedAmount: string | number; capturedAmount: string | number }>;
    const current = existing[0];
    if (!current) {
      const created = await payments().create({
        data: {
          order: input.orderId,
          providerCode: 'sepay',
          requestedAmount: input.amount,
          capturedAmount: input.amount,
          refundedAmount: 0,
          currency: input.currency,
          status: input.settles ? 'captured' : 'pending',
          actorRef: actorRefOf(ctx),
          businessDate: input.businessDate,
          capturedAt: nowOf(ctx),
        },
      });
      return {
        ...(created as PaymentRow),
        requestedAmount: input.amount,
        capturedAmount: input.amount,
        refundedAmount: 0,
      };
    }
    const capturedAmount = amountFromDb(current.capturedAmount) + input.amount;
    const requestedAmount = Math.max(amountFromDb(current.requestedAmount), capturedAmount);
    await payments().update({
      where: { id: current.id },
      data: {
        capturedAmount,
        requestedAmount,
        status: input.settles ? 'captured' : 'pending',
        capturedAt: nowOf(ctx),
        actorRef: actorRefOf(ctx),
      },
    });
    return {
      ...(current as PaymentRow),
      id: current.id,
      requestedAmount,
      capturedAmount,
      refundedAmount: amountFromDb(
        (current as PaymentRow & { refundedAmount?: string | number }).refundedAmount,
      ),
    };
  };

  const transitionIfPayable = async (aggregate: OrderAggregate, ctx: ServiceContext) => {
    const { registry, transition } = services();
    for (const group of aggregate.groups) {
      if (group.status !== 'awaiting-payment') continue;
      const definition = registry.workflow(group.workflowName, group.workflowVersion);
      const to = paymentSuccessState(definition);
      if (!to) continue;
      await transition.transitionGroup({ orderId: aggregate.order.id, groupId: group.id, to }, ctx);
    }
  };

  return {
    /**
     * Stores one inbound or outbound transfer. `duplicate` means this provider id was already
     * stored, or it confirmed a manual row with the same bank reference and amount, and the
     * ledger was not touched again.
     */
    async ingest(
      input: { event: NormalizedPaymentEvent; rawPayload: Record<string, unknown> },
      ctx: ServiceContext,
    ): Promise<{ duplicate: boolean; decision: MatchDecision }> {
      const event = input.event;
      type StoredEvent = { id: number; kind: string | null; amount: string | number; rawPayload: unknown };
      const prior = (await events().findOne({
        where: { providerCode: event.providerCode, providerTransactionId: event.providerTransactionId },
      })) as StoredEvent | null;

      const base = {
        providerCode: event.providerCode,
        providerTransactionId: event.providerTransactionId,
        kind: event.kind,
        amount: event.amount.amount,
        currency: event.amount.currency,
        transferType: event.transferType,
        rawPayload: input.rawPayload,
      };

      const remember = async (decision: MatchDecision): Promise<{ duplicate: boolean; decision: MatchDecision }> => {
        try {
          await insertEvent(
            {
              ...base,
              reviewStatus: decision.outcome === 'needs-review' ? 'needs-review' : 'ignored',
              reviewReason: decision.outcome === 'needs-review' ? decision.reviewReason : null,
            },
            ctx,
          );
          return { duplicate: false, decision };
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          return { duplicate: true, decision: { outcome: 'ignored' } };
        }
      };

      // Staff may have typed the SePay id itself. Same amount confirms that row; a different
      // amount cannot insert a second row under the same id, so it stays unconfirmed.
      if (prior) {
        if (
          event.transferType !== 'out' &&
          prior.kind === 'manual' &&
          amountFromDb(prior.amount) === event.amount.amount
        ) {
          await confirmManualRow(prior, event.providerTransactionId, ctx);
        }
        return { duplicate: true, decision: { outcome: 'ignored' } };
      }

      // The bank reference (referenceCode) is not the SePay id. Same amount attaches to the
      // manual row. A different amount is stored for review and does not capture.
      const bankReference = event.reference;
      if (event.transferType !== 'out' && bankReference && bankReference !== event.providerTransactionId) {
        const manual = (await events().findOne({
          where: { providerCode: event.providerCode, providerTransactionId: bankReference, kind: 'manual' },
        })) as StoredEvent | null;
        if (manual) {
          const manualAmount = amountFromDb(manual.amount);
          if (manualAmount === event.amount.amount) {
            await confirmManualRow(manual, event.providerTransactionId, ctx);
            return { duplicate: true, decision: { outcome: 'ignored' } };
          }
          return remember({
            outcome: 'needs-review',
            reviewReason: event.amount.amount < manualAmount ? 'underpaid' : 'overpaid',
            orderCode: null,
            dueAmount: null,
          });
        }
      }

      if (event.transferType === 'out') return remember({ outcome: 'ignored' });

      const settings = settingsOf();
      const content = text(event.metadata?.content);
      const orderCode = settings ? extractOrderCode(settings.memoTemplate, content) : null;
      if (!orderCode) {
        return remember({ outcome: 'needs-review', reviewReason: 'no-code', orderCode: null, dueAmount: null });
      }

      const orderRow = (await orders().findOne({ where: { code: orderCode }, select: ['id'] })) as {
        id: number;
      } | null;
      if (!orderRow) {
        return remember({
          outcome: 'needs-review',
          reviewReason: 'order-not-found',
          orderCode,
          dueAmount: null,
        });
      }

      const { order } = services();
      try {
        return await strapi.db.transaction(async ({ trx }) => {
          const first = await order.getOrder(orderRow.id, ctx);
          await lockGroups(trx, first);
          const aggregate = await order.getOrder(orderRow.id, ctx);
          const captured = aggregate.payments.reduce((sum, payment) => sum + payment.capturedAmount, 0);
          const payable = aggregate.groups.find((group) => group.status === 'awaiting-payment') ?? aggregate.groups[0];
          const accountNumber = text(event.metadata?.accountNumber) ?? '';
          const scope = settings ? accountScope(settings, accountNumber, text(event.metadata?.subAccount)) : null;
          const belongs =
            scope !== null &&
            (scope.locationRefs === 'all' || scope.locationRefs.includes(aggregate.order.locationRef));
          const decision = matchTransfer({
            transferType: 'in',
            orderCode,
            order: payable
              ? {
                  code: aggregate.order.code,
                  locationRef: aggregate.order.locationRef,
                  status: payable.status,
                  totalAmount: aggregate.order.totalAmount,
                  capturedAmount: captured,
                }
              : null,
            amount: event.amount.amount,
            amountTolerance: settings?.amountTolerance ?? 0,
            accountBelongsToBranch: belongs,
            captureMode: settings?.captureMode ?? 'auto',
          });

          if (decision.outcome !== 'auto-matched') {
            await insertEvent(
              {
                ...base,
                reviewStatus: decision.outcome === 'ignored' ? 'ignored' : 'needs-review',
                reviewReason: decision.outcome === 'needs-review' ? decision.reviewReason : null,
              },
              ctx,
            );
            return { duplicate: false, decision };
          }

          const due = decision.dueAmount;
          const payment = await addCapture(
            {
              orderId: aggregate.order.id,
              amount: event.amount.amount,
              currency: event.amount.currency,
              businessDate: aggregate.order.businessDate,
              settles: event.amount.amount >= due - (settings?.amountTolerance ?? 0),
            },
            ctx,
          );
          await order.recomputeProjection(aggregate.order.id);
          await insertEvent({ ...base, paymentId: payment.id, reviewStatus: 'auto-matched', reviewReason: null }, ctx);
          await services().timeline.record(
            {
              orderId: aggregate.order.id,
              type: 'payment.captured',
              isPublic: true,
              payload: { providerCode: 'sepay', amount: event.amount.amount, paymentId: payment.id },
            },
            ctx,
          );
          await transitionIfPayable(aggregate, ctx);
          return { duplicate: false, decision };
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        return { duplicate: true, decision: { outcome: 'ignored' } };
      }
    },

    /**
     * Staff (or a test) attaches an already stored transfer to an order. A short payment is
     * captured and the group stays put. Covering the remainder transitions like an auto-match.
     * A second call for the same event does not capture again.
     */
    async assignEvent(
      input: { providerCode: string; providerTransactionId: string; orderId: number },
      ctx: ServiceContext,
    ): Promise<{ applied: boolean; capturedAmount: number }> {
      const { order } = services();
      return strapi.db.transaction(async ({ trx }) => {
        const event = (await events().findOne({
          where: { providerCode: input.providerCode, providerTransactionId: input.providerTransactionId },
        })) as { id: number; amount: string | number; currency: string; reviewStatus: string } | null;
        if (!event) {
          throw new OrderingError('PAYMENT_NOT_FOUND', 'payment event not found');
        }
        await trx('plugins_ordering_payment_event').where({ id: event.id }).forUpdate().first();
        const locked = (await events().findOne({ where: { id: event.id } })) as {
          reviewStatus: string;
          amount: string | number;
          currency: string;
        };
        if (locked.reviewStatus === 'auto-matched' || locked.reviewStatus === 'matched-manually') {
          const aggregate = await order.getOrder(input.orderId, ctx);
          const captured = aggregate.payments.reduce((sum, payment) => sum + payment.capturedAmount, 0);
          return { applied: false, capturedAmount: captured };
        }
        const first = await order.getOrder(input.orderId, ctx);
        await lockGroups(trx, first);
        const aggregate = await order.getOrder(input.orderId, ctx);
        const amount = amountFromDb(locked.amount);
        const capturedBefore = aggregate.payments.reduce((sum, payment) => sum + payment.capturedAmount, 0);
        const due = Math.max(0, aggregate.order.totalAmount - capturedBefore);
        const tolerance = settingsOf()?.amountTolerance ?? 0;
        const covers = amount >= due - tolerance && amount <= due + tolerance;
        const over = amount > due + tolerance;
        const payment = await addCapture(
          {
            orderId: input.orderId,
            amount,
            currency: locked.currency || aggregate.order.currency,
            businessDate: aggregate.order.businessDate,
            settles: covers,
          },
          ctx,
        );
        await events().update({
          where: { id: event.id },
          data: {
            payment: payment.id,
            reviewStatus: over ? 'refund-due' : 'matched-manually',
            reviewedBy: actorRefOf(ctx),
            reviewedAt: nowOf(ctx),
          },
        });
        await order.recomputeProjection(input.orderId);
        await services().timeline.record(
          {
            orderId: input.orderId,
            type: 'payment.captured',
            isPublic: true,
            payload: { providerCode: input.providerCode, amount, paymentId: payment.id, manual: true },
          },
          ctx,
        );
        if (covers) await transitionIfPayable(aggregate, ctx);
        const after = await order.getOrder(input.orderId, ctx);
        return {
          applied: true,
          capturedAmount: after.payments.reduce((sum, row) => sum + row.capturedAmount, 0),
        };
      });
    },

    /**
     * Captures a transfer the staff already saw. The bank reference is `providerTransactionId`.
     * Covering the due moves `awaiting-payment` forward. A short payment stays pending.
     * More than the due is still captured and marked `refund-due` (no refund row).
     */
    async recordManual(
      input: { orderId: number; reference: string; amount: number; currency: string; transferredAt: string },
      ctx: ServiceContext,
    ): Promise<{ eventId: number; paymentId: number; reviewStatus: 'matched-manually' | 'refund-due' }> {
      const { order } = services();
      return strapi.db.transaction(async ({ trx }) => {
        const first = await order.getOrder(input.orderId, ctx);
        await lockGroups(trx, first);
        const aggregate = await order.getOrder(input.orderId, ctx);
        const existing = await events().findOne({
          where: { providerCode: 'sepay', providerTransactionId: input.reference },
        });
        if (existing) {
          throw new OrderingError('VALIDATION_ERROR', 'bank reference already recorded', {
            details: { field: 'reference' },
          });
        }
        const capturedBefore = aggregate.payments.reduce((sum, payment) => sum + payment.capturedAmount, 0);
        const due = Math.max(0, aggregate.order.totalAmount - capturedBefore);
        const tolerance = settingsOf()?.amountTolerance ?? 0;
        const covers = input.amount >= due - tolerance && input.amount <= due + tolerance;
        const over = input.amount > due + tolerance;
        const payment = await addCapture(
          {
            orderId: input.orderId,
            amount: input.amount,
            currency: input.currency || aggregate.order.currency,
            businessDate: aggregate.order.businessDate,
            settles: covers,
          },
          ctx,
        );
        await order.recomputeProjection(input.orderId);
        const reviewStatus: 'matched-manually' | 'refund-due' = over ? 'refund-due' : 'matched-manually';
        const event = await insertEvent(
          {
            providerCode: 'sepay',
            providerTransactionId: input.reference,
            kind: 'manual',
            amount: input.amount,
            currency: input.currency || aggregate.order.currency,
            transferType: 'in',
            rawPayload: { manual: true, confirmed: false, transferredAt: input.transferredAt },
            paymentId: payment.id,
            reviewStatus,
            reviewReason: null,
          },
          ctx,
        );
        await services().timeline.record(
          {
            orderId: input.orderId,
            type: 'payment.captured',
            isPublic: true,
            payload: { providerCode: 'sepay', amount: input.amount, paymentId: payment.id, manual: true },
          },
          ctx,
        );
        if (covers) await transitionIfPayable(aggregate, ctx);
        return { eventId: event.id, paymentId: payment.id, reviewStatus };
      });
    },
  };
};

export default paymentMatching;
