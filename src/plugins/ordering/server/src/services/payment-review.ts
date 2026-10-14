import type { Core } from '@strapi/strapi';

import { normalizeVietnamesePhone } from '../../../shared/contact/phone';
import type { OrderingConfig } from '../config';
import { OrderingError } from '../domain/errors';
import type { LocationScope } from '../domain/scope';
import { amountFromDb } from '../domain/money';
import { payableTotal } from '../domain/payable';
import { CLOSED_GROUP_STATUSES } from '../domain/payments/match';
import { extractOrderCode } from '../domain/payments/memo';
import type { TransactionClient } from '../migrations/runner';
import { accountScope, type SepaySettings } from '../providers/sepay/config';
import { sepaySettingsFromConfig } from '../providers/sepay/provider';
import type { ServiceContext } from './context';
import { actorRefOf, nowOf } from './context';
import type changeLogFactory from './change-log';
import type orderServiceFactory from './order';
import type outboxFactory from './outbox';
import type paymentMatchingFactory from './payment-matching';
import type pickupSchedulingFactory from './pickup-scheduling';
import type scopeFactory from './scope';
import type timelineFactory from './timeline';

type EventRow = {
  id: number;
  providerCode: string;
  providerTransactionId: string;
  amount: string | number;
  currency: string;
  rawPayload: Record<string, unknown> | null;
  receivedAt: string;
  reviewStatus: string;
  reviewReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  transferType: string | null;
  kind: string | null;
};

const OPEN = 'needs-review';
const RESOLVED = ['matched-manually', 'refund-due', 'ignored'];
/** Every open review is listed. The resolved tab is history: the newest rows only. */
const OPEN_LIMIT = 5000;
const RESOLVED_LIMIT = 1000;

const maskAccount = (value: string | null): string | null => {
  if (!value) return null;
  const digits = value.replace(/\s/g, '');
  if (digits.length <= 8) return `${digits.slice(0, 2)}•••`;
  return `${digits.slice(0, 4)}•••${digits.slice(-4)}`;
};

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

const assertReason = (reason: unknown): string => {
  if (typeof reason !== 'string' || reason.trim().length < 5) {
    throw new OrderingError('VALIDATION_ERROR', 'a reason of at least 5 characters is required', {
      details: { field: 'reason' },
    });
  }
  return reason.trim();
};

/**
 * Staff review of unmatched transfers (contracts §19.1). Branch scope is applied here.
 * Money that cannot be tied to a branch is visible only to `allLocations`. Two reviewers
 * of one event: the row lock lets one commit; the other gets `REVIEW_ALREADY_RESOLVED`.
 */
const paymentReview = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ordering');
  const scope = () => plugin().service('scope') as ReturnType<typeof scopeFactory>;
  const matching = () => plugin().service('payment-matching') as ReturnType<typeof paymentMatchingFactory>;
  const changeLog = () => plugin().service('change-log') as ReturnType<typeof changeLogFactory>;
  const scheduling = () => plugin().service('pickup-scheduling') as ReturnType<typeof pickupSchedulingFactory>;
  const timeline = () => plugin().service('timeline') as ReturnType<typeof timelineFactory>;
  const outbox = () => plugin().service('outbox') as ReturnType<typeof outboxFactory>;
  const orderService = () => plugin().service('order') as ReturnType<typeof orderServiceFactory>;
  const events = () => strapi.db.query('plugin::ordering.payment-event');
  const orders = () => strapi.db.query('plugin::ordering.order');
  /** Payable total of a raw order row (bigint columns arrive as strings). */
  const payableOf = (row: { totalAmount: string | number; canceledAmount?: string | number | null } | undefined) =>
    row
      ? payableTotal({
          totalAmount: amountFromDb(row.totalAmount),
          canceledAmount: amountFromDb(row.canceledAmount ?? 0),
        })
      : 0;
  const groups = () => strapi.db.query('plugin::ordering.fulfillment-group');
  const payments = () => strapi.db.query('plugin::ordering.payment');
  const refunds = () => strapi.db.query('plugin::ordering.refund');
  const settingsOf = (): SepaySettings | null =>
    sepaySettingsFromConfig((strapi.config.get('plugin::ordering') as OrderingConfig).providers.payment);

  const locationOf = (row: EventRow, settings: SepaySettings | null): 'all' | string[] | null => {
    if (!settings) return null;
    // Reconciliation rows keep the configured account key, not the account number.
    const accountKey = text(row.rawPayload?.accountKey);
    if (accountKey) return settings.accounts[accountKey]?.locationRefs ?? null;
    const account = accountScope(
      settings,
      text(row.rawPayload?.accountNumber) ?? '',
      text(row.rawPayload?.subAccount),
    );
    if (!account) return null;
    return account.locationRefs;
  };

  const visible = (staffScope: LocationScope | null, location: 'all' | string[] | null): boolean => {
    if (!staffScope) return false;
    if (staffScope.allLocations) return true;
    if (location === null) return false;
    if (location === 'all') return staffScope.locationRefs.length > 0;
    return location.some((ref) => staffScope.locationRefs.includes(ref));
  };

  /** Webhook rows keep the memo; reconciliation rows keep only the code taken from it. */
  const codeOf = (row: EventRow, settings: SepaySettings | null): string | null => {
    const stored = text(row.rawPayload?.memoCode);
    if (stored) return stored;
    return settings ? extractOrderCode(settings.memoTemplate, text(row.rawPayload?.content)) : null;
  };

  const lockEvent = async (trx: TransactionClient, id: number): Promise<EventRow> => {
    const found = (await events().findOne({ where: { id } })) as EventRow | null;
    if (!found || found.providerCode !== 'sepay') {
      throw new OrderingError('PAYMENT_NOT_FOUND', 'payment event not found');
    }
    await trx('plugins_ordering_payment_event').where({ id }).forUpdate().first();
    const locked = (await events().findOne({ where: { id } })) as EventRow;
    if (locked.reviewStatus !== OPEN) {
      throw new OrderingError('REVIEW_ALREADY_RESOLVED', 'this transfer was already reviewed');
    }
    return locked;
  };

  const assertVisible = async (row: EventRow, ctx: ServiceContext) => {
    const staffScope = await scope().loadScope(ctx);
    if (!visible(staffScope, locationOf(row, settingsOf()))) {
      throw new OrderingError('PAYMENT_NOT_FOUND', 'payment event not found');
    }
  };

  const audit = (
    action: string,
    row: EventRow,
    after: Record<string, unknown>,
    locationRef: string | undefined,
    ctx: ServiceContext,
  ) =>
    changeLog().record(
      {
        action,
        entityType: 'payment-event',
        entityId: row.id,
        locationRef,
        before: { reviewStatus: row.reviewStatus },
        after,
      },
      ctx,
    );

  return {
    async list(
      query: { status?: string; reason?: string; branch?: string; from?: string; to?: string; q?: string; page?: number; pageSize?: number },
      ctx: ServiceContext,
    ) {
      const staffScope = await scope().loadScope(ctx);
      if (!staffScope) throw new OrderingError('SCOPE_REQUIRED', 'staff member has no location scope');
      const settings = settingsOf();
      // Status is filtered in the database. Auto-matched transfers are most of the table; reading
      // the newest N of everything would push older open reviews out of the list and the counts.
      // Branch visibility depends on the receiving account in rawPayload, so it stays in memory.
      const base = {
        providerCode: 'sepay',
        transferType: 'in',
        $or: [{ kind: { $null: true } }, { kind: { $ne: 'manual' } }],
      };
      const load = async (statuses: string[], limit: number) =>
        ((await events().findMany({
          where: { ...base, reviewStatus: { $in: statuses } },
          orderBy: { receivedAt: 'desc' },
          limit,
        })) as EventRow[])
          .map((row) => ({ row, location: locationOf(row, settings) }))
          .filter((item) => visible(staffScope, item.location));
      const openRows = await load([OPEN], OPEN_LIMIT);
      const resolvedRows = await load(RESOLVED, RESOLVED_LIMIT);
      const openCount = openRows.length;
      const resolvedCount = resolvedRows.length;
      const located = query.status === 'resolved' ? resolvedRows : openRows;
      const q = query.q?.trim().toLowerCase();
      const filtered = located.filter(({ row, location }) => {
        if (query.reason && row.reviewReason !== query.reason) return false;
        if (query.branch) {
          const refs = location === 'all' ? null : location;
          if (!refs?.includes(query.branch)) return false;
        }
        const at = new Date(row.receivedAt).getTime();
        if (query.from && at < new Date(query.from).getTime()) return false;
        if (query.to && at > new Date(query.to).getTime()) return false;
        if (q) {
          const content = (text(row.rawPayload?.content) ?? text(row.rawPayload?.memoCode) ?? '').toLowerCase();
          const id = row.providerTransactionId.toLowerCase();
          const amount = String(amountFromDb(row.amount));
          if (!content.includes(q) && !id.includes(q) && amount !== q) return false;
        }
        return true;
      });
      const page = Math.max(1, query.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
      const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
      const codes = [...new Set(slice.map(({ row }) => codeOf(row, settings)).filter((code): code is string => Boolean(code)))];
      const orderRows = codes.length
        ? ((await orders().findMany({ where: { code: { $in: codes } } })) as Array<{
            id: number;
            code: string;
            locationRef: string;
            totalAmount: string | number;
            canceledAmount?: string | number | null;
            status: string;
          }>)
        : [];
      const orderIds = orderRows.map((order) => order.id);
      const capturedByOrder = new Map<number, number>();
      const payableByOrder = new Map<number, number>();
      const statusByOrder = new Map<number, string>();
      await Promise.all(
        orderIds.map(async (id) => {
          const pay = (await payments().findMany({ where: { order: id } })) as Array<{
            capturedAmount: string | number;
          }>;
          const row = orderRows.find((candidate) => candidate.id === id);
          payableByOrder.set(id, payableOf(row));
          capturedByOrder.set(
            id,
            pay.reduce((sum, row) => sum + amountFromDb(row.capturedAmount), 0),
          );
          const group = (await groups().findMany({ where: { order: id } })) as Array<{ status: string }>;
          const first = group[0];
          if (first) statusByOrder.set(id, first.status);
        }),
      );
      const byCode = new Map(orderRows.map((order) => [order.code, order]));
      const logRows = slice.length
        ? ((await strapi.db.query('plugin::ordering.admin-change-log').findMany({
            where: {
              entityType: 'payment-event',
              entityId: { $in: slice.map(({ row }) => String(row.id)) },
            },
            orderBy: { occurredAt: 'desc' },
            limit: 500,
          })) as Array<{ entityId: string; changes: { reason?: { after?: unknown } } | null }>)
        : [];
      const reasonByEvent = new Map<string, string>();
      for (const log of logRows) {
        if (reasonByEvent.has(log.entityId)) continue;
        const after = log.changes?.reason?.after;
        if (typeof after === 'string') reasonByEvent.set(log.entityId, after);
      }
      const results = slice.map(({ row, location }) => {
        const code = codeOf(row, settings);
        const order = code ? byCode.get(code) : undefined;
        const due = order
          ? Math.max(0, (payableByOrder.get(order.id) ?? 0) - (capturedByOrder.get(order.id) ?? 0))
          : null;
        const groupStatus = order ? statusByOrder.get(order.id) ?? null : null;
        const closed = groupStatus === 'canceled' || groupStatus === 'expired';
        return {
          id: row.id,
          receivedAt: row.receivedAt,
          amount: amountFromDb(row.amount),
          currency: row.currency,
          content: text(row.rawPayload?.content),
          accountMasked: maskAccount(text(row.rawPayload?.accountNumber)),
          locationRefs: location,
          providerTransactionId: row.providerTransactionId,
          reviewStatus: row.reviewStatus,
          reviewReason: row.reviewReason,
          reviewedBy: row.reviewedBy,
          reviewedAt: row.reviewedAt,
          suggestedOrder: order
            ? { id: order.id, code: order.code, due, locationRef: order.locationRef, status: groupStatus }
            : null,
          canReopen: row.reviewReason === 'order-closed' && closed,
          staffReason: reasonByEvent.get(String(row.id)) ?? null,
        };
      });
      return {
        results,
        pagination: { page, pageSize, total: filtered.length },
        counts: { open: openCount, resolved: resolvedCount },
      };
    },

    async searchOrders(q: string, ctx: ServiceContext) {
      const staffScope = await scope().loadScope(ctx);
      const where = scope().orderWhere(staffScope);
      const query = q.trim();
      if (query.length < 2) return { results: [] };
      const phone = normalizeVietnamesePhone(query);
      const match: Record<string, unknown>[] = [{ code: { $containsi: query } }];
      if (phone.valid) match.push({ contactSnapshot: { $containsi: phone.e164 } });
      const rows = (await orders().findMany({
        where: { $and: [where, { $or: match }] },
        orderBy: { placedAt: 'desc' },
        limit: 8,
      })) as Array<{
        id: number;
        code: string;
        locationRef: string;
        totalAmount: string | number;
        canceledAmount?: string | number | null;
        status: string;
      }>;
      const results = [];
      for (const order of rows) {
        const pay = (await payments().findMany({ where: { order: order.id } })) as Array<{
          capturedAmount: string | number;
        }>;
        const captured = pay.reduce((sum, row) => sum + amountFromDb(row.capturedAmount), 0);
        results.push({
          id: order.id,
          code: order.code,
          locationRef: order.locationRef,
          status: order.status,
          due: Math.max(0, payableOf(order) - captured),
        });
      }
      return { results };
    },

    async assign(id: number, input: { orderId?: number; reason?: unknown }, ctx: ServiceContext) {
      const reason = assertReason(input.reason);
      if (!Number.isInteger(input.orderId)) {
        throw new OrderingError('VALIDATION_ERROR', 'orderId is required', { details: { field: 'orderId' } });
      }
      const orderId = input.orderId as number;
      return strapi.db.transaction(async ({ trx }) => {
        const row = await lockEvent(trx, id);
        await assertVisible(row, ctx);
        const staffScope = await scope().loadScope(ctx);
        const order = (await orders().findOne({ where: { id: orderId } })) as { id: number; locationRef: string } | null;
        if (!order || !visible(staffScope, [order.locationRef])) {
          throw new OrderingError('ORDER_NOT_FOUND', 'order not found');
        }
        // Money on a canceled order would sit in the ledger with nothing to deliver. A closed
        // order goes through reopen, which checks the slot and restarts the payment window.
        const orderGroups = (await groups().findMany({ where: { order: orderId } })) as Array<{ status: string }>;
        const live = orderGroups.filter(
          (group) => !(CLOSED_GROUP_STATUSES as readonly string[]).includes(group.status),
        );
        if (live.length === 0) {
          throw new OrderingError('ORDER_CLOSED', 'the order is closed; reopen it instead');
        }
        const applied = await matching().assignEvent(
          { providerCode: row.providerCode, providerTransactionId: row.providerTransactionId, orderId },
          ctx,
        );
        if (!applied.applied) {
          throw new OrderingError('REVIEW_ALREADY_RESOLVED', 'this transfer was already reviewed');
        }
        const updated = (await events().findOne({ where: { id: row.id } })) as EventRow;
        await audit(
          'payment-review.assign',
          row,
          { reviewStatus: updated.reviewStatus, reason, orderId },
          order.locationRef,
          ctx,
        );
        return { ok: true, capturedAmount: applied.capturedAmount };
      });
    },

    async refundDue(id: number, input: { amount?: number; reason?: unknown }, ctx: ServiceContext) {
      const reason = assertReason(input.reason);
      return strapi.db.transaction(async ({ trx }) => {
        const row = await lockEvent(trx, id);
        await assertVisible(row, ctx);
        const full = amountFromDb(row.amount);
        const amount = input.amount ?? full;
        if (!Number.isSafeInteger(amount) || amount <= 0 || amount > full) {
          throw new OrderingError('VALIDATION_ERROR', 'refund amount must be within the transfer', {
            details: { field: 'amount' },
          });
        }
        const refund = await refunds().create({
          data: {
            amount,
            currency: row.currency,
            reason,
            actorRef: actorRefOf(ctx),
            status: 'pending',
          },
        });
        await events().update({
          where: { id: row.id },
          data: { reviewStatus: 'refund-due', reviewedBy: actorRefOf(ctx), reviewedAt: nowOf(ctx) },
        });
        // The refund row has no order or payment; this log entry is what ties it to the transfer.
        await audit(
          'payment-review.refund-due',
          row,
          { reviewStatus: 'refund-due', reason, amount, refundId: refund.id },
          undefined,
          ctx,
        );
        return { ok: true, refundId: refund.id as number };
      });
    },

    async ignore(id: number, input: { reason?: unknown }, ctx: ServiceContext) {
      const reason = assertReason(input.reason);
      return strapi.db.transaction(async ({ trx }) => {
        const row = await lockEvent(trx, id);
        await assertVisible(row, ctx);
        await events().update({
          where: { id: row.id },
          data: { reviewStatus: 'ignored', reviewedBy: actorRefOf(ctx), reviewedAt: nowOf(ctx) },
        });
        await audit('payment-review.ignore', row, { reviewStatus: 'ignored', reason }, undefined, ctx);
        return { ok: true };
      });
    },

    async reopen(id: number, input: { orderId?: number; reason?: unknown }, ctx: ServiceContext) {
      const reason = assertReason(input.reason);
      if (!Number.isInteger(input.orderId)) {
        throw new OrderingError('VALIDATION_ERROR', 'orderId is required', { details: { field: 'orderId' } });
      }
      const orderId = input.orderId as number;
      return strapi.db.transaction(async ({ trx }) => {
        const row = await lockEvent(trx, id);
        await assertVisible(row, ctx);
        if (row.reviewReason !== 'order-closed') {
          throw new OrderingError('REOPEN_UNAVAILABLE', 'only a closed order can be reopened from review');
        }
        const staffScope = await scope().loadScope(ctx);
        const order = (await orders().findOne({ where: { id: orderId } })) as {
          id: number;
          code: string;
          locationRef: string;
          receiveMethod: { timing?: { slot?: { startsAt?: string; endsAt?: string } } } | null;
        } | null;
        if (!order || !visible(staffScope, [order.locationRef])) {
          throw new OrderingError('ORDER_NOT_FOUND', 'order not found');
        }
        const settings = settingsOf();
        const memoCode = codeOf(row, settings);
        if (memoCode && memoCode !== order.code) {
          throw new OrderingError('VALIDATION_ERROR', 'the transfer memo does not match this order', {
            details: { field: 'orderId' },
          });
        }
        const found = (await groups().findOne({ where: { order: orderId } })) as { id: number } | null;
        if (found) await trx('plugins_ordering_fulfillment_group').where({ id: found.id }).forUpdate().first();
        const group = found
          ? ((await groups().findOne({ where: { id: found.id } })) as {
              id: number;
              status: string;
              workflowName: string;
              workflowVersion: string;
            })
          : null;
        if (!group || (group.status !== 'canceled' && group.status !== 'expired')) {
          throw new OrderingError('REOPEN_UNAVAILABLE', 'the order is not closed');
        }
        const startsAt = order.receiveMethod?.timing?.slot?.startsAt;
        const endsAt = order.receiveMethod?.timing?.slot?.endsAt;
        if (startsAt && endsAt) {
          if (new Date(endsAt).getTime() <= nowOf(ctx).getTime()) {
            throw new OrderingError('REOPEN_UNAVAILABLE', 'the pickup slot has passed');
          }
          const branch = await strapi.db.query('plugin::ordering.branch').findOne({ where: { code: order.locationRef } });
          const pickup = (branch?.fulfillment as { pickup?: { schedule?: { capacity?: number } } } | null)?.pickup;
          const capacity = pickup?.schedule?.capacity ?? 8;
          try {
            await scheduling().reserveInTransaction(
              trx,
              { orderId, groupId: group.id, locationRef: order.locationRef, slot: { startsAt, endsAt }, capacity },
              ctx,
            );
          } catch (error) {
            if (error instanceof OrderingError && error.code === 'SLOT_FULL') {
              throw new OrderingError('REOPEN_UNAVAILABLE', 'the pickup slot is full');
            }
            throw error;
          }
        }
        // Terminal states have no outgoing edge, so reopening is written here rather than through
        // the transition service. It still records the step like a transition: the timeline entry
        // restarts the payment window (paymentWindowStart), and the outbox feeds the inbox stream.
        await groups().update({ where: { id: group.id }, data: { status: 'awaiting-payment' } });
        const transitionPayload = {
          groupId: group.id,
          from: group.status,
          to: 'awaiting-payment',
          workflowName: group.workflowName,
          workflowVersion: group.workflowVersion,
          reason: 'payment-review-reopen',
        };
        await timeline().record(
          { orderId, type: 'fulfillment-group.transitioned', isPublic: true, payload: transitionPayload },
          ctx,
        );
        const projection = await orderService().recomputeProjection(orderId);
        if (projection.before.status !== projection.after.status) {
          await outbox().enqueue(
            {
              type: 'order.transitioned',
              aggregateType: 'order',
              aggregateId: String(orderId),
              payload: {
                orderId,
                from: projection.before.status,
                to: projection.after.status,
                actorRef: actorRefOf(ctx),
                locationRef: order.locationRef,
              },
              uniqueKey: `order-reopen:${orderId}:${row.id}`,
            },
            ctx,
          );
        }
        await outbox().enqueue(
          {
            type: 'fulfillment-group.transitioned',
            aggregateType: 'fulfillment-group',
            aggregateId: String(group.id),
            payload: {
              orderId,
              ...transitionPayload,
              actorRef: actorRefOf(ctx),
              isPublic: true,
              notifyCustomer: false,
              locationRef: order.locationRef,
              reasonCode: 'payment-review-reopen',
            },
            uniqueKey: `fgt:${group.id}:${group.status}>awaiting-payment:reopen:${row.id}`,
          },
          ctx,
        );
        const applied = await matching().assignEvent(
          { providerCode: row.providerCode, providerTransactionId: row.providerTransactionId, orderId },
          ctx,
        );
        if (!applied.applied) {
          throw new OrderingError('REVIEW_ALREADY_RESOLVED', 'this transfer was already reviewed');
        }
        await audit(
          'payment-review.reopen',
          row,
          { reviewStatus: 'matched-manually', reason, orderId },
          order.locationRef,
          ctx,
        );
        return { ok: true, capturedAmount: applied.capturedAmount };
      });
    },
  };
};

export default paymentReview;
