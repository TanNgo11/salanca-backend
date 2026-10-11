import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import { maskPhone, normalizeVietnamesePhone } from '../../../shared/contact/phone';
import type { WorkflowDefinition } from '../contracts/workflow';
import { businessDate as businessDateOf } from '../domain/business-date';
import { OrderingError } from '../domain/errors';
import { amountFromDb } from '../domain/money';
import { parseCartRequest, parseOrderRequest } from '../domain/storefront/parse';
import { paidAmounts, type SelectedOptionSnapshot } from '../domain/storefront/serialize';
import { isTerminal } from '../domain/workflow/transition';
import type { TransactionClient } from '../migrations/runner';
import orderRepository from '../repositories/order';
import type { OrderAggregate } from '../repositories/types';
import type branchFactory from './branch';
import type { ServiceContext } from './context';
import { nowOf } from './context';
import type lineCancelFactory from './line-cancel';
import type orderServiceFactory from './order';
import type orderingSettingsFactory from './ordering-settings';
import type paymentFactory from './payment';
import type refundFactory from './refund';
import type { OrderingRegistry } from './registry';
import type scopeFactory from './scope';
import type timelineFactory from './timeline';
import type transitionFactory from './transition';

/** Inbox tabs group workflow states (screens S1); a tab is not a single state. */
export const TABS = ['awaiting', 'preparing', 'ready', 'done', 'canceled', 'all', 'drafts'] as const;
export type Tab = (typeof TABS)[number];

const tabOf = (definition: WorkflowDefinition, status: string): Exclude<Tab, 'all'> => {
  const terminal = isTerminal(definition, status);
  if (terminal === 'success') return 'done';
  if (terminal === 'canceled') return 'canceled';
  if (status === 'awaiting-acceptance' || status === 'awaiting-payment') return 'awaiting';
  if (status === 'ready') return 'ready';
  return 'preparing';
};

const MAX_NOTE = 1000;

/** Bank reference shown to staff: short codes keep the first two characters, longer codes keep both ends. */
const maskReference = (value: string): string =>
  value.length <= 8 ? `${value.slice(0, 2)}•••` : `${value.slice(0, 4)}•••${value.slice(-4)}`;

const eventConfirmed = (kind: string | null, reviewStatus: string, rawPayload: unknown): boolean => {
  if (kind === 'manual') {
    const raw =
      rawPayload !== null && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
        ? (rawPayload as Record<string, unknown>)
        : {};
    return raw.confirmed === true;
  }
  return reviewStatus === 'auto-matched';
};
const SUCCESS_REQUIRES_PAYMENT = 'cash';

export type NextTransition = {
  to: string;
  kind: 'primary' | 'secondary' | 'danger';
  requires: Array<'reason' | 'cash'>;
};

/**
 * Admin order handling (screens S1–S5; plan step 7). Every method resolves the staff scope
 * (out of scope = ORDER_NOT_FOUND, 404) and the route already checked the action. Money moves
 * and state changes that belong together run in one outer transaction — nested
 * `strapi.db.transaction` calls reuse it, so a failure anywhere rolls everything back.
 */
const adminOrders = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ordering');
  const s = {
    order: () => plugin().service('order') as ReturnType<typeof orderServiceFactory>,
    transition: () => plugin().service('transition') as ReturnType<typeof transitionFactory>,
    payment: () => plugin().service('payment') as ReturnType<typeof paymentFactory>,
    refund: () => plugin().service('refund') as ReturnType<typeof refundFactory>,
    lineCancel: () => plugin().service('line-cancel') as ReturnType<typeof lineCancelFactory>,
    timeline: () => plugin().service('timeline') as ReturnType<typeof timelineFactory>,
    scope: () => plugin().service('scope') as ReturnType<typeof scopeFactory>,
    branch: () => plugin().service('branch') as ReturnType<typeof branchFactory>,
    settings: () => plugin().service('ordering-settings') as ReturnType<typeof orderingSettingsFactory>,
    registry: () => plugin().service('registry') as OrderingRegistry,
  };
  const repo = orderRepository({ strapi });
  const workflowOf = (group: { workflowName: string; workflowVersion: string }) =>
    s.registry().workflow(group.workflowName, group.workflowVersion);

  const liveGroup = (aggregate: OrderAggregate) =>
    aggregate.groups.find((group) => isTerminal(workflowOf(group), group.status) === null) ??
    aggregate.groups[0];

  const nextTransitions = (aggregate: OrderAggregate): NextTransition[] => {
    const group = liveGroup(aggregate);
    if (!group || aggregate.order.status === 'draft') return [];
    const definition = workflowOf(group);
    const due = paidAmounts(aggregate).due;
    const next = definition.states[group.status]?.next ?? [];
    const firstForward = next.find((to) => isTerminal(definition, to) !== 'canceled');
    return next
      .filter((to) => to !== definition.cancelState)
      .map((to) => {
        const terminal = isTerminal(definition, to);
        const requires: NextTransition['requires'] = [];
        if (terminal === 'canceled') requires.push('reason');
        if (terminal === 'success' && due > 0) requires.push('cash');
        return {
          to,
          kind: terminal === 'canceled' ? 'danger' : to === firstForward ? 'primary' : 'secondary',
          requires,
        };
      });
  };

  /** Accepting = leaving awaiting-acceptance forward; that sets estimatedReadyAt. */
  const isAcceptance = (definition: WorkflowDefinition, from: string, to: string) =>
    from === 'awaiting-acceptance' && isTerminal(definition, to) === null;

  const rowOf = (
    aggregate: OrderAggregate,
    context: { now: Date; slaMinutes: number; tab: Exclude<Tab, 'all'> },
  ) => {
    const { order } = aggregate;
    const group = liveGroup(aggregate);
    const contact = order.contactSnapshot as { name?: string; phone?: string };
    const national = normalizeVietnamesePhone(contact.phone ?? '');
    const receive = order.receiveMethod as {
      kind?: string;
      timing?: { mode?: string; slot?: { startsAt: string } };
    };
    const waitingMinutes = Math.max(
      0,
      Math.floor((context.now.getTime() - new Date(order.placedAt).getTime()) / 60_000),
    );
    return {
      id: order.id,
      code: order.code,
      status: order.status,
      groupStatus: group?.status ?? null,
      tab: context.tab,
      placedAt: order.placedAt,
      businessDate: order.businessDate,
      locationRef: order.locationRef,
      receive: {
        kind: receive.kind ?? 'pickup',
        mode: receive.timing?.mode ?? null,
        slotStartsAt: receive.timing?.slot?.startsAt ?? null,
        estimatedReadyAt: group?.estimatedReadyAt ?? null,
      },
      customer: {
        name: contact.name ?? null,
        phoneMasked: national.valid ? maskPhone(national.national) : null,
      },
      items: aggregate.lines.map((line) => ({ title: line.titleSnapshot, quantity: line.quantity })),
      itemCount: aggregate.lines.reduce((sum, line) => sum + line.quantity - line.canceledQuantity, 0),
      total: order.totalAmount,
      paymentStatus: order.paymentStatus,
      waitingMinutes,
      overdue: context.tab === 'awaiting' && waitingMinutes > context.slaMinutes,
      origin: order.origin.kind,
      next: nextTransitions(aggregate).find((item) => item.kind === 'primary') ?? null,
    };
  };

  const loadScoped = async (orderId: number, ctx: ServiceContext) =>
    s.order().getOrder(orderId, ctx); // scope check inside (404 out of scope)

  const service = {
    nextTransitions,

    /** GET /orders — tabs with counts, filters, 20 rows per page (screens S1). */
    async list(
      filters: {
        tab?: string;
        branch?: string;
        businessDate?: string;
        q?: string;
        payment?: string;
        origin?: string;
        page?: number;
        pageSize?: number;
      },
      ctx: ServiceContext,
    ) {
      const staffScope = await s.scope().loadScope(ctx);
      const conditions: Record<string, unknown>[] = [s.scope().orderWhere(staffScope)];
      if (filters.branch) conditions.push({ locationRef: filters.branch });
      const tab: Tab = (TABS as readonly string[]).includes(filters.tab ?? '')
        ? (filters.tab as Tab)
        : 'awaiting';
      const q = filters.q?.trim();
      if (q) {
        const phone = normalizeVietnamesePhone(q);
        // Search ignores the day filter so staff can find yesterday's order by code or phone.
        conditions.push({
          $or: [
            { code: { $containsi: q } },
            ...(phone.valid ? [{ contactSnapshot: { $containsi: phone.e164 } }] : []),
            { contactSnapshot: { $containsi: q } },
          ],
        });
      } else if (filters.businessDate) {
        conditions.push({ businessDate: filters.businessDate });
      }
      if (filters.payment) conditions.push({ paymentStatus: filters.payment });
      // Drafts (staff phone orders not yet confirmed) only show in their own tab.
      conditions.push(tab === 'drafts' ? { status: 'draft' } : { status: { $ne: 'draft' } });
      const rows = (await strapi.db.query('plugin::ordering.order').findMany({
        where: { $and: conditions },
        orderBy: { placedAt: 'desc' },
        limit: 500,
        select: ['id'],
      })) as Array<{ id: number }>;
      const now = new Date();
      const branchSla = new Map<string, number>();
      const counts: Record<Tab, number> = {
        awaiting: 0,
        preparing: 0,
        ready: 0,
        done: 0,
        canceled: 0,
        all: 0,
        drafts: 0,
      };
      const items: ReturnType<typeof rowOf>[] = [];
      for (const { id } of rows) {
        const aggregate = await repo.loadOrderAggregate(id);
        if (!aggregate) continue;
        if (filters.origin && aggregate.order.origin.kind !== filters.origin) continue;
        const group = liveGroup(aggregate);
        if (!group) continue;
        const rowTab = tabOf(workflowOf(group), group.status);
        if (tab === 'drafts') {
          counts.drafts += 1;
        } else {
          counts[rowTab] += 1;
          counts.all += 1;
          if (tab !== 'all' && tab !== rowTab) continue;
        }
        let sla = branchSla.get(aggregate.order.locationRef);
        if (sla === undefined) {
          const branch = await s.branch().findByCode(aggregate.order.locationRef);
          sla = s.branch().pickupSettings(branch ?? { fulfillment: null }).slaMinutes;
          branchSla.set(aggregate.order.locationRef, sla);
        }
        items.push(rowOf(aggregate, { now, slaMinutes: sla, tab: rowTab }));
      }
      if (tab === 'awaiting') items.reverse(); // oldest waiting first
      const pageSize = Math.min(Math.max(filters.pageSize ?? 20, 1), 100);
      const page = Math.max(filters.page ?? 1, 1);
      return {
        results: items.slice((page - 1) * pageSize, page * pageSize),
        pagination: { page, pageSize, total: items.length, pageCount: Math.ceil(items.length / pageSize) },
        counts,
        tab,
      };
    },

    /** GET /orders/summary?since= — polling fallback for the realtime inbox. */
    async summary(since: string | undefined, ctx: ServiceContext) {
      const staffScope = await s.scope().loadScope(ctx);
      const where: Record<string, unknown>[] = [s.scope().orderWhere(staffScope), { status: 'open' }];
      const open = (await strapi.db.query('plugin::ordering.order').findMany({
        where: { $and: where },
        select: ['id', 'code', 'placedAt', 'locationRef'],
        orderBy: { placedAt: 'asc' },
        limit: 500,
      })) as Array<{ id: number; code: string; placedAt: string; locationRef: string }>;
      let awaiting = 0;
      const fresh: Array<{ id: number; code: string; locationRef: string; placedAt: string }> = [];
      const sinceMs = since ? new Date(since).getTime() : Number.NaN;
      for (const row of open) {
        const groups = (await strapi.db
          .query('plugin::ordering.fulfillment-group')
          .findMany({ where: { order: row.id }, select: ['status'] })) as Array<{ status: string }>;
        if (groups.some((group) => group.status === 'awaiting-acceptance')) {
          awaiting += 1;
          if (Number.isFinite(sinceMs) && new Date(row.placedAt).getTime() > sinceMs) fresh.push(row);
        }
      }
      // Staff without settings.manage still need the inbox options (dialog, sound, reasons, delays).
      return { awaiting, newOrders: fresh, at: new Date().toISOString(), settings: await s.settings().get() };
    },

    /** GET /orders/:id — everything S4 shows plus valid next steps. */
    async detail(orderId: number, ctx: ServiceContext) {
      const aggregate = await loadScoped(orderId, ctx);
      const events = (await s.timeline().listAll(orderId)) as Array<{
        id: number;
        type: string;
        actorRef: string;
        isPublic: boolean;
        payload: Record<string, unknown> | null;
        occurredAt: string;
      }>;
      const branch = await s.branch().findByCode(aggregate.order.locationRef);
      const settings = s.branch().pickupSettings(branch ?? { fulfillment: null });
      const money = paidAmounts(aggregate);
      const group = liveGroup(aggregate);
      const paymentEvents = (
        await Promise.all(
          aggregate.payments.map(async (payment) => {
            const rows = (await strapi.db.query('plugin::ordering.payment-event').findMany({
              where: { payment: payment.id },
              orderBy: { receivedAt: 'asc' },
            })) as Array<{
              id: number;
              kind: string | null;
              amount: string | number;
              providerTransactionId: string;
              reviewStatus: string;
              rawPayload: unknown;
              receivedAt: string;
            }>;
            return rows.map((row) => ({
              id: row.id,
              paymentId: payment.id,
              kind: row.kind,
              amount: amountFromDb(row.amount),
              referenceMasked: maskReference(row.providerTransactionId),
              reviewStatus: row.reviewStatus,
              confirmed: eventConfirmed(row.kind, row.reviewStatus, row.rawPayload),
              receivedAt: row.receivedAt,
            }));
          }),
        )
      ).flat();
      const actorIds = [
        ...new Set(
          events
            .map((event) => /^admin:(\d+)$/.exec(event.actorRef ?? '')?.[1])
            .filter((value): value is string => value !== undefined)
            .map(Number),
        ),
      ];
      const admins = actorIds.length
        ? ((await strapi.db
            .query('admin::user')
            .findMany({ where: { id: { $in: actorIds } }, select: ['id', 'firstname', 'lastname'] })) as Array<{
            id: number;
            firstname?: string;
            lastname?: string;
          }>)
        : [];
      const nameOf = new Map(
        admins.map((admin) => [`admin:${admin.id}`, [admin.firstname, admin.lastname].filter(Boolean).join(' ')]),
      );
      return {
        order: {
          id: aggregate.order.id,
          code: aggregate.order.code,
          status: aggregate.order.status,
          paymentStatus: aggregate.order.paymentStatus,
          fulfillmentStatus: aggregate.order.fulfillmentStatus,
          placedAt: aggregate.order.placedAt,
          businessDate: aggregate.order.businessDate,
          locationRef: aggregate.order.locationRef,
          branch: {
            code: aggregate.order.locationRef,
            name: (aggregate.order.branchSnapshot as { name?: unknown } | null)?.name ?? null,
            timezone: branch?.timezone ?? 'Asia/Ho_Chi_Minh',
          },
          origin: aggregate.order.origin,
          contact: aggregate.order.contactSnapshot,
          consent: aggregate.order.consentSnapshot,
          customerNote: aggregate.order.customerNote,
          placedLocale: aggregate.order.placedLocale,
          receiveMethod: aggregate.order.receiveMethod,
        },
        group: group
          ? {
              id: group.id,
              status: group.status,
              workflow: `${group.workflowName}@${group.workflowVersion}`,
              estimatedReadyAt: group.estimatedReadyAt,
              slaMinutes: settings.slaMinutes,
            }
          : null,
        lines: aggregate.lines.map((line) => ({
          id: line.id,
          title: line.titleSnapshot,
          sku: line.sku,
          options: ((line.selectedOptionsSnapshot as SelectedOptionSnapshot[] | null) ?? []).map((option) => ({
            group: option.groupName ?? option.groupUid,
            name: option.optionName ?? option.optionUid,
            quantity: option.quantity,
          })),
          note: line.note,
          quantity: line.quantity,
          canceledQuantity: line.canceledQuantity,
          unitAmount: line.unitAmount,
          optionAmount: line.optionAmount,
          lineTotalAmount: line.lineTotalAmount,
        })),
        adjustments: aggregate.adjustments.map((adjustment) => ({
          kind: adjustment.kind,
          code: adjustment.code,
          label: adjustment.label,
          amount: adjustment.amount,
        })),
        totals: {
          currency: aggregate.order.currency,
          subtotal: aggregate.order.subtotalAmount,
          adjustment: aggregate.order.adjustmentAmount,
          fulfillment: aggregate.order.fulfillmentAmount,
          tax: aggregate.order.taxAmount,
          total: aggregate.order.totalAmount,
          paid: money.captured,
          refunded: money.refunded,
          due: money.due,
        },
        payments: aggregate.payments.map((payment) => ({
          id: payment.id,
          providerCode: payment.providerCode,
          status: payment.status,
          requestedAmount: payment.requestedAmount,
          capturedAmount: payment.capturedAmount,
          refundedAmount: payment.refundedAmount,
          actorRef: payment.actorRef,
          actorName: nameOf.get(payment.actorRef ?? '') ?? null,
          capturedAt: payment.capturedAt,
        })),
        paymentEvents,
        refunds: aggregate.refunds.map((refund) => ({
          id: refund.id,
          amount: refund.amount,
          reason: refund.reason,
          status: refund.status,
          actorRef: refund.actorRef,
          actorName: nameOf.get(refund.actorRef ?? '') ?? null,
          settledAt: refund.settledAt,
        })),
        timeline: events.map((event) => ({
          id: event.id,
          type: event.type,
          isPublic: event.isPublic,
          actorRef: event.actorRef,
          actorName: nameOf.get(event.actorRef) ?? null,
          payload: event.payload,
          occurredAt: event.occurredAt,
        })),
        nextTransitions: nextTransitions(aggregate),
        settings: { delayMinutes: (await s.settings().get()).delayMinutes },
      };
    },

    /**
     * POST /orders/:id/transition — one step forward/back along the workflow. Acceptance sets
     * `estimatedReadyAt` (slot start, or now + preparation time for ASAP, plus `delayMinutes`);
     * rejection needs a reason; reaching a success terminal with money due must go through
     * cash-handover instead. A concurrent winner leaves the loser with INVALID_TRANSITION.
     */
    async transition(
      orderId: number,
      input: {
        to: string;
        note?: string;
        notifyCustomer?: boolean;
        delayMinutes?: number;
        reasonCode?: string;
      },
      ctx: ServiceContext,
    ) {
      const note = input.note?.trim();
      if (note && note.length > MAX_NOTE) {
        throw new OrderingError('VALIDATION_ERROR', 'note is too long', { details: { field: 'note' } });
      }
      return strapi.db.transaction(async () => {
        const aggregate = await loadScoped(orderId, ctx);
        const group = liveGroup(aggregate);
        if (!group) throw new OrderingError('INVALID_TRANSITION', 'order has no active group');
        const definition = workflowOf(group);
        const terminal = isTerminal(definition, input.to);
        if (terminal === 'canceled' && !input.reasonCode && !note) {
          throw new OrderingError('VALIDATION_ERROR', 'a reason is required', {
            details: { field: 'reasonCode' },
          });
        }
        if (input.reasonCode) {
          const reasons = (await s.settings().get()).rejectReasons.map((item) => item.code);
          if (input.reasonCode !== 'other' && !reasons.includes(input.reasonCode)) {
            throw new OrderingError('VALIDATION_ERROR', 'unknown reason code', {
              details: { field: 'reasonCode' },
            });
          }
        }
        if (terminal === 'success' && paidAmounts(aggregate).due > 0) {
          throw new OrderingError('PAYMENT_REQUIRED', 'collect the payment with cash handover first', {
            details: { due: paidAmounts(aggregate).due },
          });
        }
        if (input.delayMinutes !== undefined) {
          if (!Number.isInteger(input.delayMinutes) || input.delayMinutes < 1 || input.delayMinutes > 240) {
            throw new OrderingError('VALIDATION_ERROR', 'delayMinutes must be 1–240', {
              details: { field: 'delayMinutes' },
            });
          }
        }
        let estimatedReadyAt: string | undefined;
        if (isAcceptance(definition, group.status, input.to)) {
          const branch = await s.branch().findByCode(aggregate.order.locationRef);
          const settings = s.branch().pickupSettings(branch ?? { fulfillment: null });
          const receive = aggregate.order.receiveMethod as {
            timing?: { slot?: { startsAt?: string } };
          };
          const base = receive.timing?.slot?.startsAt
            ? new Date(receive.timing.slot.startsAt)
            : new Date(nowOf(ctx).getTime() + settings.schedule.leadTimeMinutes * 60_000);
          estimatedReadyAt = new Date(base.getTime() + (input.delayMinutes ?? 0) * 60_000).toISOString();
          await strapi.db
            .query('plugin::ordering.fulfillment-group')
            .update({ where: { id: group.id }, data: { estimatedReadyAt } });
        }
        const result = await s.transition().transitionGroup(
          {
            orderId,
            groupId: group.id,
            to: input.to,
            reason: input.reasonCode ?? (terminal === 'canceled' ? note : undefined),
            notifyCustomer: input.notifyCustomer,
            payload: {
              ...(note ? { note } : {}),
              ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
              ...(input.delayMinutes ? { delayMinutes: input.delayMinutes } : {}),
              ...(estimatedReadyAt ? { estimatedReadyAt } : {}),
            },
          },
          ctx,
        );
        return { from: result.from, to: result.to, detail: await service.detail(orderId, ctx) };
      });
    },

    /**
     * POST /orders/:id/cash-handover — "Thu tiền và giao" (contracts §19.3): records the cash for
     * the amount due and moves the group to its success terminal in ONE transaction.
     */
    async cashHandover(orderId: number, input: { method?: string }, ctx: ServiceContext) {
      const method = input.method ?? SUCCESS_REQUIRES_PAYMENT;
      if (method !== 'cash') {
        throw new OrderingError('VALIDATION_ERROR', 'only cash is supported at the counter in O3', {
          details: { field: 'method' },
        });
      }
      return strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
        const aggregate = await loadScoped(orderId, ctx);
        const group = liveGroup(aggregate);
        if (!group) throw new OrderingError('INVALID_TRANSITION', 'order has no active group');
        const definition = workflowOf(group);
        await repo.lockGroup(trx, group.id);
        const success = (definition.states[group.status]?.next ?? []).find(
          (to) => isTerminal(definition, to) === 'success',
        );
        if (!success) {
          throw new OrderingError('INVALID_TRANSITION', `cannot hand over from "${group.status}"`, {
            details: { status: group.status },
          });
        }
        const due = paidAmounts(aggregate).due;
        let collected = 0;
        if (due > 0) {
          const payment = await s.payment().createPayment({ orderId, providerCode: 'cash', amount: due }, ctx);
          await s.payment().capturePayment(
            {
              paymentId: payment.id,
              amount: due,
              providerTransactionId: `cash-handover:${orderId}:${randomUUID()}`,
            },
            ctx,
          );
          collected = due;
        }
        await s.transition().transitionGroup(
          {
            orderId,
            groupId: group.id,
            to: success,
            payload: { collectedAmount: collected, method },
          },
          ctx,
        );
        return { collected, detail: await service.detail(orderId, ctx) };
      });
    },

    /**
     * POST /orders/:id/cancel — staff cancel. Captured cash still held is refunded through the
     * cash provider in the same transaction as the cancel (contracts §19.3).
     */
    async cancel(orderId: number, input: { reasonCode?: string; note?: string }, ctx: ServiceContext) {
      const reason = input.reasonCode ?? input.note?.trim();
      if (!reason) {
        throw new OrderingError('VALIDATION_ERROR', 'a reason is required', { details: { field: 'reasonCode' } });
      }
      return strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
        const before = await loadScoped(orderId, ctx);
        if (before.order.status === 'canceled' || before.order.status === 'completed') {
          throw new OrderingError('INVALID_TRANSITION', 'order is already closed', {
            details: { status: before.order.status },
          });
        }
        await s.transition().cancelOrder(
          { orderId, reason, payload: input.note?.trim() ? { note: input.note.trim() } : undefined },
          ctx,
        );
        let refunded = 0;
        for (const payment of before.payments) {
          const held = payment.capturedAmount - payment.refundedAmount;
          if (payment.providerCode !== 'cash' || held <= 0) continue;
          const { amount } = await s.refund().createRefundInTransaction(
            trx,
            { paymentId: payment.id, amount: held, reason: `cancel: ${reason}` },
            ctx,
          );
          refunded += amount;
        }
        return { refunded, detail: await service.detail(orderId, ctx) };
      });
    },

    /** POST /orders/:id/notes — internal note, never public (screens S4b). */
    async addNote(orderId: number, text: string | undefined, ctx: ServiceContext) {
      const note = text?.trim();
      if (!note || note.length > MAX_NOTE) {
        throw new OrderingError('VALIDATION_ERROR', 'note must be 1–1000 characters', {
          details: { field: 'text' },
        });
      }
      await loadScoped(orderId, ctx);
      await s.timeline().record({ orderId, type: 'note', isPublic: false, payload: { text: note } }, ctx);
      return service.detail(orderId, ctx);
    },

    /**
     * GET /orders/:id/lines/:lineId/cancel-preview?quantity= — the exact refund the cancel would
     * write: the real cancel runs in a transaction that is then rolled back.
     */
    async lineCancelPreview(orderId: number, lineId: number, quantity: number, ctx: ServiceContext) {
      const rollback = new Error('ordering-preview-rollback');
      let preview: { refundAmount: number; refundShortfall: number } | null = null;
      try {
        await strapi.db.transaction(async () => {
          const result = await s.lineCancel().cancelLineQuantity(
            { orderId, lineId, quantity, reason: 'preview' },
            ctx,
          );
          preview = { refundAmount: result.refundAmount, refundShortfall: result.refundShortfall };
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
      return preview as unknown as { refundAmount: number; refundShortfall: number };
    },

    /** POST /orders/:id/lines/:lineId/cancel — partial cancel with cash refund (contracts §21.5). */
    async cancelLine(
      orderId: number,
      lineId: number,
      input: { quantity: number; reason?: string },
      ctx: ServiceContext,
    ) {
      const result = await s.lineCancel().cancelLineQuantity(
        { orderId, lineId, quantity: input.quantity, reason: input.reason ?? '' },
        ctx,
      );
      return {
        refundAmount: result.refundAmount,
        refundShortfall: result.refundShortfall,
        detail: await service.detail(orderId, ctx),
      };
    },

    /** POST /orders/:id/refunds — manual cash refund up to what the cash payments still hold. */
    async refundCash(
      orderId: number,
      input: { amount: number; reason?: string; idempotencyKey?: string },
      ctx: ServiceContext,
    ) {
      const aggregate = await loadScoped(orderId, ctx);
      const payment = aggregate.payments.find(
        (row) => row.providerCode === 'cash' && row.capturedAmount - row.refundedAmount > 0,
      );
      if (!payment) {
        throw new OrderingError('REFUND_EXCEEDS_CAPTURED', 'no cash payment left to refund');
      }
      const max = payment.capturedAmount - payment.refundedAmount;
      if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > max) {
        throw new OrderingError('REFUND_EXCEEDS_CAPTURED', 'refund amount exceeds what was collected', {
          details: { max },
        });
      }
      await s.refund().createRefund(
        {
          paymentId: payment.id,
          amount: input.amount,
          reason: input.reason ?? '',
          idempotencyKey: input.idempotencyKey ?? `admin-refund:${randomUUID()}`,
        },
        ctx,
      );
      return service.detail(orderId, ctx);
    },

    /**
     * Staff phone orders (contracts §21.3; screens S6). The page keeps the cart; the server prices
     * it (`quoteDraft`), saves it as a draft order that already holds its pickup slot
     * (`createDraft`, origin staff-draft, consent channel phone-staff), and `confirmDraft` releases
     * it into the live flow. Prices come from the catalog pipeline — no manual price in v1.
     */
    async quoteDraft(body: unknown, ctx: ServiceContext) {
      const cart = parseCartRequest(body);
      return s.order().quote(
        {
          ...cart,
          contact: { phone: '' },
          consent: { policyVersion: '', channel: 'phone-staff' },
          origin: { kind: 'staff-draft', actorRef: ctx.actor.actorRef },
        },
        ctx,
      );
    },

    async createDraft(body: unknown, ctx: ServiceContext) {
      const request = parseOrderRequest(body);
      const raw = (body ?? {}) as { idempotencyKey?: unknown };
      const idempotencyKey =
        typeof raw.idempotencyKey === 'string' && /^[A-Za-z0-9_:.-]{8,128}$/.test(raw.idempotencyKey)
          ? raw.idempotencyKey
          : undefined;
      if (!idempotencyKey) {
        throw new OrderingError('VALIDATION_ERROR', 'idempotencyKey is required', {
          details: { field: 'idempotencyKey' },
        });
      }
      const { captchaToken: _captcha, ...input } = request;
      const result = await s.order().createOrder(
        {
          ...input,
          idempotencyKey,
          consent: { ...input.consent, channel: 'phone-staff' },
          origin: { kind: 'staff-draft', actorRef: ctx.actor.actorRef },
        },
        ctx,
      );
      return service.detail(result.order.order.id, ctx);
    },

    async confirmDraft(orderId: number, ctx: ServiceContext) {
      await s.order().confirmDraft(orderId, ctx); // scope + draft checks inside
      return service.detail(orderId, ctx);
    },

    async deleteDraft(orderId: number, ctx: ServiceContext) {
      const aggregate = await loadScoped(orderId, ctx);
      if (aggregate.order.status !== 'draft') {
        throw new OrderingError('VALIDATION_ERROR', 'only drafts can be deleted', {
          details: { status: aggregate.order.status },
        });
      }
      await s.transition().cancelOrder({ orderId, reason: 'draft-deleted' }, ctx);
      return { deleted: true };
    },

    /** GET /orders/branches — the viewer's branches with today's business date (inbox filter). */
    async branchesForStaff(ctx: ServiceContext) {
      const staffScope = await s.scope().loadScope(ctx);
      if (staffScope === null) throw new OrderingError('SCOPE_REQUIRED', 'staff member has no location scope');
      const rows = await s.branch().list();
      return rows
        .filter((row) => row.isActive && (staffScope.allLocations || staffScope.locationRefs.includes(row.code)))
        .map((row) => {
          const settings = s.branch().pickupSettings(row);
          return {
            code: row.code,
            name: row.name ?? {},
            timezone: row.timezone,
            onlineOrdering: row.onlineOrdering,
            businessDate: businessDateOf(new Date(), row.timezone, settings.schedule.businessDayPolicy.cutoffLocalTime),
          };
        });
    },

    /** Business date "today" for a branch — the inbox default (screens S1). */
    async todayFor(locationRef: string): Promise<string> {
      const branch = await s.branch().findByCode(locationRef);
      const settings = s.branch().pickupSettings(branch ?? { fulfillment: null });
      return businessDateOf(new Date(), branch?.timezone ?? 'Asia/Ho_Chi_Minh', settings.schedule.businessDayPolicy.cutoffLocalTime);
    },

  };
  return service;
};

export default adminOrders;
