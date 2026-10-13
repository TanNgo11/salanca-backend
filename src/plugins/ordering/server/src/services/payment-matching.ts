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
import type alertFactory from './alert';
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

type ReferenceRow = { id: number; kind: string | null; amount: string | number; rawPayload: unknown };

type ReferenceDb = {
  raw: (sql: string, bindings: readonly unknown[]) => Promise<{ rows?: ReferenceRow[] }>;
};

/**
 * Other rows that share this bank reference: the manual id, or `rawPayload.referenceCode`.
 * Case-insensitive: staff may type `ft…` for the bank's `FT…`.
 */
const referenceRows = async (
  db: ReferenceDb,
  input: { providerCode: string; providerTransactionId: string; reference: string },
): Promise<ReferenceRow[]> => {
  const { rows } = await db.raw(
    `SELECT id, kind, amount, raw_payload AS "rawPayload"
       FROM plugins_ordering_payment_event
      WHERE provider_code = ?
        AND provider_transaction_id <> ?
        AND (
          UPPER(provider_transaction_id) = UPPER(?)
          OR UPPER(COALESCE(raw_payload->>'referenceCode', '')) = UPPER(?)
        )
      LIMIT 20`,
    [input.providerCode, input.providerTransactionId, input.reference, input.reference],
  );
  return rows ?? [];
};

/**
 * `raw_payload` read through `db.raw` arrives as JSON text (the ORM parses it, raw SQL does
 * not). Anything that is not an object reads as `{}`.
 */
const payloadObject = (value: unknown): Record<string, unknown> => {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
};

type SameTimeRow = { rawPayload: unknown };

/**
 * Rows with the same amount, direction and SePay `transactionDate` under another id. Used only
 * when the bank sent no reference: the webhook (integer id) and reconciliation (UUID) then have
 * nothing else in common.
 */
const sameTimeRows = async (
  db: { raw: (sql: string, bindings: readonly unknown[]) => Promise<{ rows?: SameTimeRow[] }> },
  input: { providerCode: string; providerTransactionId: string; amount: number; transferType: string; transactionDate: string },
): Promise<SameTimeRow[]> => {
  const { rows } = await db.raw(
    `SELECT raw_payload AS "rawPayload"
       FROM plugins_ordering_payment_event
      WHERE provider_code = ?
        AND provider_transaction_id <> ?
        AND amount = ?
        AND transfer_type = ?
        AND raw_payload->>'transactionDate' = ?
      LIMIT 20`,
    [input.providerCode, input.providerTransactionId, input.amount, input.transferType, input.transactionDate],
  );
  return rows ?? [];
};

type ReferenceHit =
  | { kind: 'confirm-manual'; row: ReferenceRow }
  | { kind: 'review-manual'; reason: 'underpaid' | 'overpaid' }
  | { kind: 'duplicate' }
  | { kind: 'continue' };

/**
 * Same bank reference and same amount is one transfer, whether the other row is a manual
 * record, a webhook integer id, or a reconciliation UUID. A manual row with a different
 * amount stays unconfirmed and is reviewed. Anything else continues into matching.
 */
const referenceHit = (rows: ReferenceRow[], amount: number): ReferenceHit => {
  const manual = rows.find((row) => row.kind === 'manual');
  if (manual) {
    const manualAmount = amountFromDb(manual.amount);
    if (manualAmount === amount) return { kind: 'confirm-manual', row: manual };
    return { kind: 'review-manual', reason: amount < manualAmount ? 'underpaid' : 'overpaid' };
  }
  if (rows.some((row) => amountFromDb(row.amount) === amount)) return { kind: 'duplicate' };
  return { kind: 'continue' };
};

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
  const alerts = () => strapi.plugin('ordering').service('alert') as ReturnType<typeof alertFactory>;

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
    // Reference rows come from raw SQL, so the payload may still be JSON text.
    const raw = payloadObject(row.rawPayload);
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
     * Moves `awaiting-payment` groups forward when nothing is due. A transfer can be captured
     * before the group reaches that state (accept-then-pay paid before acceptance); without this
     * the group would wait there with nothing owed and the payment-expiry job would expire it.
     * Returns whether a group moved. Runs inside the caller's transaction when there is one.
     */
    async advanceIfPaid(orderId: number, ctx: ServiceContext): Promise<boolean> {
      const { order } = services();
      return strapi.db.transaction(async ({ trx }) => {
        const first = await order.getOrder(orderId, ctx);
        if (!first.groups.some((group) => group.status === 'awaiting-payment')) return false;
        await lockGroups(trx, first);
        const aggregate = await order.getOrder(orderId, ctx);
        const captured = aggregate.payments.reduce((sum, payment) => sum + payment.capturedAmount, 0);
        // Same tolerance as an auto-match: a transfer short by at most this much settles.
        if (aggregate.order.totalAmount - captured > (settingsOf()?.amountTolerance ?? 0)) return false;
        if (!aggregate.groups.some((group) => group.status === 'awaiting-payment')) return false;
        await transitionIfPayable(aggregate, ctx);
        return true;
      });
    },

    /**
     * Stores one inbound or outbound transfer. `duplicate` means this provider id was already
     * stored, or the same bank reference and amount already confirmed a manual row or another
     * SePay id (webhook integer vs reconciliation UUID), and the ledger was not touched again.
     */
    async ingest(
      input: { event: NormalizedPaymentEvent; rawPayload: Record<string, unknown> },
      ctx: ServiceContext,
    ): Promise<{ duplicate: boolean; decision: MatchDecision }> {
      const event = input.event;
      // Alert after the insert commits. Opening one inside the ingest transaction would
      // share that transaction, and a concurrent alert insert (23505) would roll the payment back.
      const flagUnmatched = async (result: {
        duplicate: boolean;
        decision: MatchDecision;
      }): Promise<{ duplicate: boolean; decision: MatchDecision }> => {
        if (!result.duplicate && result.decision.outcome === 'needs-review') {
          await alerts().noteUnmatched(event.providerCode, ctx);
        }
        return result;
      };
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

      // O13 wallet providers (momo, vnpay): the IPN's `reference` is the session's
      // providerReference `<orderCode>-<paymentId>` — the payment row already exists, so
      // matching is a row lookup, not a memo parse. Signature was verified before this runs.
      const walletProvider = services().registry.hasPaymentProvider(event.providerCode)
        ? services().registry.paymentProvider(event.providerCode)
        : null;
      if (walletProvider?.capabilities.includes('wallet')) {
        const walletPark = async (
          reviewStatus: 'needs-review' | 'ignored',
          reviewReason: string | null,
          paymentId: number | null = null,
        ) => {
          try {
            await insertEvent({ ...base, paymentId, reviewStatus, reviewReason }, ctx);
            return {
              duplicate: false,
              decision:
                reviewStatus === 'needs-review'
                  ? ({
                      outcome: 'needs-review',
                      reviewReason: (reviewReason ?? 'no-code') as never,
                      orderCode: null,
                      dueAmount: null,
                    } satisfies MatchDecision)
                  : ({ outcome: 'ignored' } satisfies MatchDecision),
            };
          } catch (error) {
            if (!isUniqueViolation(error)) throw error;
            return { duplicate: true, decision: { outcome: 'ignored' } satisfies MatchDecision };
          }
        };
        const walletIngest = async (): Promise<{ duplicate: boolean; decision: MatchDecision }> => {
          if (event.transferType === 'out') return walletPark('ignored', null);
          const reference = event.reference?.trim() ?? '';
          if (reference === '') return walletPark('needs-review', 'no-code');
          const parked = (await payments().findOne({
            where: { providerCode: event.providerCode, providerReference: reference },
          })) as { id: number } | null;
          if (!parked) return walletPark('needs-review', 'order-not-found');
          try {
            return await strapi.db.transaction(async ({ trx }) => {
              await repo.lockPayment(trx, parked.id);
              const locked = (await payments().findOne({
                where: { id: parked.id },
                populate: { order: { columns: ['id'] } },
              })) as {
                id: number;
                order: { id: number } | number;
                status: string;
                requestedAmount: string | number;
                currency: string;
                session: unknown;
              } | null;
              if (!locked) return walletPark('needs-review', 'order-not-found');
              const orderId =
                typeof locked.order === 'object' ? locked.order.id : locked.order;
              // `services()` — not a destructure: `ingest` declares `const { order }` later,
              // which would make a bare `order` binding hit the TDZ here.
              const aggregate = await services().order.getOrder(orderId, ctx);
              await lockGroups(trx, aggregate);

              // A terminal-failure event on a still-pending session marks the payment failed —
              // the order stays awaiting-payment until a new session or the expiry job.
              if (event.kind === 'failed') {
                if (locked.status === 'pending') {
                  await payments().update({
                    where: { id: locked.id },
                    data: { status: 'failed', actorRef: actorRefOf(ctx) },
                  });
                }
                return walletPark('ignored', 'result-failed', locked.id);
              }
              if (locked.status === 'captured') {
                return walletPark('ignored', 'already-paid', locked.id);
              }
              if (locked.status !== 'pending') {
                return walletPark('needs-review', 'order-closed', locked.id);
              }
              const requested = amountFromDb(locked.requestedAmount);
              if (event.amount.amount !== requested) {
                return walletPark(
                  'needs-review',
                  event.amount.amount > requested ? 'overpaid' : 'underpaid',
                  locked.id,
                );
              }
              // The provider's transaction id is folded into the session — refund/query APIs
              // (VNPay refund needs vnp_TransactionNo; querydr derives the transaction date
              // from session.initiatedAt, which initiate already stored).
              const session = {
                ...(locked.session !== null &&
                typeof locked.session === 'object' &&
                !Array.isArray(locked.session)
                  ? (locked.session as Record<string, unknown>)
                  : {}),
                transactionNo: event.providerTransactionId,
                ...(typeof event.metadata?.payDate === 'string'
                  ? { payDate: event.metadata.payDate }
                  : {}),
              };
              await payments().update({
                where: { id: locked.id },
                data: {
                  capturedAmount: event.amount.amount,
                  status: 'captured',
                  capturedAt: nowOf(ctx),
                  actorRef: actorRefOf(ctx),
                  session,
                },
              });
              await insertEvent(
                { ...base, paymentId: locked.id, reviewStatus: 'auto-matched', reviewReason: null },
                ctx,
              );
              await services().order.recomputeProjection(orderId);
              await services().timeline.record(
                {
                  orderId,
                  type: 'payment.captured',
                  isPublic: true,
                  payload: {
                    providerCode: event.providerCode,
                    amount: event.amount.amount,
                    paymentId: locked.id,
                  },
                },
                ctx,
              );
              await transitionIfPayable(aggregate, ctx);
              return {
                duplicate: false,
                decision: {
                  outcome: 'auto-matched',
                  orderCode: aggregate.order.code,
                  dueAmount: requested,
                } satisfies MatchDecision,
              };
            });
          } catch (error) {
            if (!isUniqueViolation(error)) throw error;
            return { duplicate: true, decision: { outcome: 'ignored' } };
          }
        };
        return flagUnmatched(await walletIngest());
      }

      const bankReference = event.reference;
      const applyReference = async (
        rows: ReferenceRow[],
        mode: 'remember' | 'insert',
      ): Promise<{ duplicate: boolean; decision: MatchDecision } | null> => {
        const hit = referenceHit(rows, event.amount.amount);
        if (hit.kind === 'continue') return null;
        if (hit.kind === 'confirm-manual') {
          await confirmManualRow(hit.row, event.providerTransactionId, ctx);
          return { duplicate: true, decision: { outcome: 'ignored' } };
        }
        if (hit.kind === 'duplicate') return { duplicate: true, decision: { outcome: 'ignored' } };
        const decision: MatchDecision = {
          outcome: 'needs-review',
          reviewReason: hit.reason,
          orderCode: null,
          dueAmount: null,
        };
        if (mode === 'remember') return remember(decision);
        await insertEvent(
          { ...base, reviewStatus: 'needs-review', reviewReason: hit.reason },
          ctx,
        );
        return { duplicate: false, decision };
      };

      // The bank reference is not the SePay id. Same amount attaches to a manual row, or is a
      // duplicate of a webhook/reconciliation row. A different amount on a manual row is stored
      // for review and does not capture. `out` never confirms a manual row.
      if (event.transferType !== 'out' && bankReference) {
        const applied = await applyReference(
          await referenceRows(strapi.db.connection, {
            providerCode: event.providerCode,
            providerTransactionId: event.providerTransactionId,
            reference: bankReference,
          }),
          'remember',
        );
        if (applied) return flagUnmatched(applied);
      }

      if (event.transferType === 'out') return flagUnmatched(await remember({ outcome: 'ignored' }));

      const settings = settingsOf();
      const content = text(event.metadata?.content);
      const orderCode = settings ? extractOrderCode(settings.memoTemplate, content) : null;

      // No bank reference: the same transfer seen by the webhook and by reconciliation still has
      // the same amount, SePay timestamp, receiving account and memo code. Without this, a
      // captured transfer would come back from reconciliation as `already-paid` and invite a
      // refund of money that was never overpaid.
      const transactionDate = text(event.metadata?.transactionDate);
      if (!bankReference && transactionDate && settings) {
        const keyOf = (accountNumber: unknown, subAccount: unknown) =>
          accountScope(settings, text(accountNumber) ?? '', text(subAccount))?.key ?? null;
        const accountKey = keyOf(event.metadata?.accountNumber, event.metadata?.subAccount);
        const candidates = await sameTimeRows(strapi.db.connection, {
          providerCode: event.providerCode,
          providerTransactionId: event.providerTransactionId,
          amount: event.amount.amount,
          transferType: 'in',
          transactionDate,
        });
        const same = candidates.some(({ rawPayload }) => {
          const raw = payloadObject(rawPayload);
          const rowAccount = text(raw.accountKey) ?? keyOf(raw.accountNumber, raw.subAccount);
          const rowCode = text(raw.memoCode) ?? extractOrderCode(settings.memoTemplate, text(raw.content));
          return rowAccount === accountKey && rowCode === orderCode;
        });
        if (same) return { duplicate: true, decision: { outcome: 'ignored' } };
      }
      if (!orderCode) {
        return flagUnmatched(
          await remember({ outcome: 'needs-review', reviewReason: 'no-code', orderCode: null, dueAmount: null }),
        );
      }

      const orderRow = (await orders().findOne({ where: { code: orderCode }, select: ['id'] })) as {
        id: number;
      } | null;
      if (!orderRow) {
        return flagUnmatched(
          await remember({
            outcome: 'needs-review',
            reviewReason: 'order-not-found',
            orderCode,
            dueAmount: null,
          }),
        );
      }

      const { order } = services();
      try {
        const saved = await strapi.db.transaction(async ({ trx }) => {
          if (event.transferType !== 'out' && bankReference) {
            await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [
              `sepay-ref:${event.providerCode}:${bankReference}`,
            ]);
            const applied = await applyReference(
              await referenceRows(trx, {
                providerCode: event.providerCode,
                providerTransactionId: event.providerTransactionId,
                reference: bankReference,
              }),
              'insert',
            );
            if (applied) return applied;
          }
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
        return flagUnmatched(saved);
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
        // Same lock as ingest, taken before the group locks (same order as ingest), so a
        // webhook and a manual record of one bank reference cannot both capture.
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`sepay-ref:sepay:${input.reference}`]);
        const first = await order.getOrder(input.orderId, ctx);
        await lockGroups(trx, first);
        const aggregate = await order.getOrder(input.orderId, ctx);
        const existing = await events().findOne({
          where: { providerCode: 'sepay', providerTransactionId: input.reference },
        });
        // A webhook or reconciliation row keeps the bank reference in `rawPayload.referenceCode`
        // under SePay's own id. That transfer is already stored: capture it from review instead.
        const sameTransfer = await referenceRows(trx, {
          providerCode: 'sepay',
          providerTransactionId: input.reference,
          reference: input.reference,
        });
        if (sameTransfer.length > 0) {
          throw new OrderingError('PAYMENT_ALREADY_RECEIVED', 'this bank transfer was already received from SePay', {
            details: { field: 'reference' },
          });
        }
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
