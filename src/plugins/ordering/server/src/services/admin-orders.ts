import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import { maskPhone, normalizeVietnamesePhone } from '../../../shared/contact/phone';
import type { WorkflowDefinition } from '../contracts/workflow';
import { businessDate as businessDateOf } from '../domain/business-date';
import { OrderingError } from '../domain/errors';
import { amountFromDb } from '../domain/money';
import { parseCartRequest, parseOrderRequest } from '../domain/storefront/parse';
import { paidAmounts, type SelectedOptionSnapshot } from '../domain/storefront/serialize';
import { editability } from '../domain/order-edit';
import { isTerminal } from '../domain/workflow/transition';
import type { TransactionClient } from '../migrations/runner';
import orderRepository from '../repositories/order';
import type { OrderAggregate } from '../repositories/types';
import type branchFactory from './branch';
import type { ServiceContext } from './context';
import { actorRefOf, nowOf } from './context';
import type deliveryAssignmentFactory from './delivery-assignment';
import { isDeliveryGroup } from './delivery-assignment';
import type lineCancelFactory from './line-cancel';
import type paymentLinkFactory from './payment-link';
import type paymentMatchingFactory from './payment-matching';
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

const relationId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = (value as { id: unknown }).id;
    return typeof id === 'number' && Number.isInteger(id) ? id : null;
  }
  return null;
};

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

export type NextTransition = {
  to: string;
  kind: 'primary' | 'secondary' | 'danger';
  requires: Array<'reason' | 'cash' | 'assignee'>;
};

/** A delivery leg row (`plugin::ordering.fulfillment`) as the admin views it. */
type FulfillmentLeg = {
  id: number;
  status: string;
  assigneeRef: string | null;
  addressSnapshot: unknown;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  canceledAt: string | null;
  metadata: Record<string, unknown> | null;
};

/** The `delivery` block a list row carries on the delivery board (screens D2). */
type DeliveryRow = {
  status: string | null;
  assigneeRef: string | null;
  assigneeName: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  address: unknown;
  shippedAt: string | null;
  due: number;
};

/** Delivery board tabs (screens D2): the leg's position, not the pickup inbox grouping. */
const DELIVERY_TABS = ['ready', 'out', 'failed', 'all'] as const;
const deliveryTab = (status: string): 'ready' | 'out' | 'failed' | null =>
  status === 'ready'
    ? 'ready'
    : status === 'out-for-delivery'
      ? 'out'
      : status === 'failed'
        ? 'failed'
        : null;

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
    paymentLink: () => plugin().service('payment-link') as ReturnType<typeof paymentLinkFactory>,
    matching: () => plugin().service('payment-matching') as ReturnType<typeof paymentMatchingFactory>,
    timeline: () => plugin().service('timeline') as ReturnType<typeof timelineFactory>,
    delivery: () => plugin().service('delivery-assignment') as ReturnType<typeof deliveryAssignmentFactory>,
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

  /**
   * Gives back the money still held when an order closes as canceled (contracts §19.1, §19.8).
   * Cash is refunded now; a captured transfer becomes a refund row the bank provider leaves
   * `pending` until staff settle it. Call it after the close took the group locks: payments are
   * re-read here, so a transfer captured just before the close is not missed.
   */
  const refundHeld = async (trx: TransactionClient, orderId: number, reason: string, ctx: ServiceContext) => {
    const payments = (await repo.loadOrderAggregate(orderId))?.payments ?? [];
    let refunded = 0;
    let refundPending = 0;
    for (const payment of payments) {
      const held = payment.capturedAmount - payment.refundedAmount;
      if (held <= 0) continue;
      if (payment.providerCode === 'cash') {
        const { amount } = await s
          .refund()
          .createRefundInTransaction(trx, { paymentId: payment.id, amount: held, reason }, ctx);
        refunded += amount;
      } else {
        const room = held - (await pendingRefundSum(strapi, payment.id));
        if (room <= 0) continue;
        const { amount, status } = await s
          .refund()
          .createRefundInTransaction(trx, { paymentId: payment.id, amount: room, reason }, ctx);
        if (status === 'settled') refunded += amount;
        else refundPending += amount;
      }
    }
    return { refunded, refundPending };
  };

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
        if (terminal === 'canceled' || to === 'failed') requires.push('reason');
        if (to === 'out-for-delivery') requires.push('assignee');
        if (terminal === 'success' && due > 0) requires.push('cash');
        return {
          to,
          kind:
            terminal === 'canceled' || to === 'failed'
              ? 'danger'
              : to === firstForward
                ? 'primary'
                : 'secondary',
          requires,
        };
      });
  };

  /** Accepting = leaving awaiting-acceptance forward; that sets estimatedReadyAt. */
  const isAcceptance = (definition: WorkflowDefinition, from: string, to: string) =>
    from === 'awaiting-acceptance' && isTerminal(definition, to) === null;

  const rowOf = (
    aggregate: OrderAggregate,
    context: { now: Date; slaMinutes: number; tab: Exclude<Tab, 'all'> | 'out' | 'failed' },
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

    /**
     * GET /orders — tabs with counts, filters, 20 rows per page (screens S1). `receive=delivery`
     * switches to the delivery board (screens D2): tabs ready|out|failed come from the leg's
     * state, `assignee` filters by courier (`unassigned` | `mine` | `admin:<id>`), and each row
     * carries the leg's assignee, address, tracking and amount due.
     */
    async list(
      filters: {
        tab?: string;
        branch?: string;
        businessDate?: string;
        q?: string;
        payment?: string;
        origin?: string;
        receive?: string;
        assignee?: string;
        page?: number;
        pageSize?: number;
      },
      ctx: ServiceContext,
    ) {
      const staffScope = await s.scope().loadScope(ctx);
      const conditions: Record<string, unknown>[] = [s.scope().orderWhere(staffScope)];
      if (filters.branch) conditions.push({ locationRef: filters.branch });
      const receive =
        filters.receive === 'delivery' ? 'delivery' : filters.receive === 'pickup' ? 'pickup' : null;
      const tab: string =
        receive === 'delivery'
          ? (DELIVERY_TABS as readonly string[]).includes(filters.tab ?? '')
            ? (filters.tab as string)
            : 'ready'
          : (TABS as readonly string[]).includes(filters.tab ?? '')
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
      const counts: Record<string, number> =
        receive === 'delivery'
          ? { ready: 0, out: 0, failed: 0, all: 0 }
          : { awaiting: 0, preparing: 0, ready: 0, done: 0, canceled: 0, all: 0, drafts: 0 };
      const items: Array<ReturnType<typeof rowOf> & { delivery?: DeliveryRow }> = [];
      const legs = new Map<number, { leg: FulfillmentLeg | null; due: number }>();
      for (const { id } of rows) {
        const aggregate = await repo.loadOrderAggregate(id);
        if (!aggregate) continue;
        if (filters.origin && aggregate.order.origin.kind !== filters.origin) continue;
        const group = liveGroup(aggregate);
        if (!group) continue;
        const kind = isDeliveryGroup(group) ? 'delivery' : 'pickup';
        if (receive && kind !== receive) continue;
        let rowTab: Exclude<Tab, 'all'> | 'out' | 'failed';
        if (receive === 'delivery') {
          const dt = deliveryTab(group.status);
          if (dt === null) continue; // legs before ready and closed legs are off the board
          const leg = (await strapi.db.query('plugin::ordering.fulfillment').findOne({
            where: { group: group.id },
          })) as FulfillmentLeg | null;
          const assignee = filters.assignee?.trim();
          const ref = leg?.assigneeRef ?? null;
          if (
            (assignee === 'unassigned' && ref !== null) ||
            (assignee === 'mine' && ref !== actorRefOf(ctx)) ||
            (assignee === 'other' && (ref === null || ref === actorRefOf(ctx))) ||
            (assignee &&
              assignee !== 'unassigned' &&
              assignee !== 'mine' &&
              assignee !== 'other' &&
              ref !== assignee)
          ) {
            continue;
          }
          counts[dt] += 1;
          counts.all += 1;
          if (tab !== 'all' && tab !== dt) continue;
          legs.set(id, { leg, due: paidAmounts(aggregate).due });
          rowTab = dt;
        } else {
          rowTab = tabOf(workflowOf(group), group.status);
          if (tab === 'drafts') {
            counts.drafts += 1;
          } else {
            counts[rowTab] += 1;
            counts.all += 1;
            if (tab !== 'all' && tab !== rowTab) continue;
          }
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
      if (legs.size > 0) {
        // Courier names for the "Người giao" column — one lookup for every visible leg.
        const refs = [...legs.values()]
          .map(({ leg }) => leg?.assigneeRef)
          .filter((ref): ref is string => typeof ref === 'string');
        const ids = [...new Set(refs.map((ref) => Number(/^admin:(\d+)$/.exec(ref)?.[1])))].filter(
          Number.isInteger,
        );
        const admins = ids.length
          ? ((await strapi.db.query('admin::user').findMany({
              where: { id: { $in: ids } },
              select: ['id', 'firstname', 'lastname'],
            })) as Array<{ id: number; firstname?: string; lastname?: string }>)
          : [];
        const nameOf = new Map(
          admins.map((admin) => [
            `admin:${admin.id}`,
            [admin.firstname, admin.lastname].filter(Boolean).join(' '),
          ]),
        );
        for (const row of items) {
          const entry = legs.get(row.id);
          if (!entry) continue;
          const { leg, due } = entry;
          row.delivery = {
            status: leg?.status ?? null,
            assigneeRef: leg?.assigneeRef ?? null,
            assigneeName: leg?.assigneeRef ? (nameOf.get(leg.assigneeRef) ?? null) : null,
            carrier: (leg?.metadata as { carrier?: string } | null)?.carrier ?? null,
            trackingNumber: leg?.trackingNumber ?? null,
            address: leg?.addressSnapshot ?? null,
            shippedAt: leg?.shippedAt ?? null,
            due,
          };
        }
      }
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
      // The delivery leg of a delivery group (O5): assignee, address, tracking and the last
      // failure live on the fulfillment row — the order's next steps still read the group.
      const deliveryGroup = aggregate.groups.find(isDeliveryGroup);
      const leg = deliveryGroup
        ? ((await strapi.db.query('plugin::ordering.fulfillment').findOne({
            where: { group: deliveryGroup.id },
          })) as FulfillmentLeg | null)
        : null;
      const openStatuses = aggregate.groups
        .filter((group) => isTerminal(workflowOf(group), group.status) === null)
        .map((group) => group.status);
      const receiveKind =
        (aggregate.order.receiveMethod as { kind?: string } | null)?.kind ?? 'pickup';
      const editState = editability(receiveKind, aggregate.order.status, openStatuses);
      const actorIds = [
        ...new Set(
          [...events.map((event) => event.actorRef), leg?.assigneeRef]
            .map((ref) => /^admin:(\d+)$/.exec(ref ?? '')?.[1])
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
          editRevision: aggregate.order.editRevision ?? 0,
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
          addedInRevision: line.addedInRevision ?? null,
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
          paymentId: relationId(refund.payment),
          amount: refund.amount,
          reason: refund.reason,
          status: refund.status,
          actorRef: refund.actorRef,
          actorName: nameOf.get(refund.actorRef ?? '') ?? null,
          settledAt: refund.settledAt,
          referenceMasked: refund.providerReference ? maskReference(refund.providerReference) : null,
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
        delivery: leg
          ? {
              status: leg.status,
              assigneeRef: leg.assigneeRef,
              assigneeName: leg.assigneeRef ? (nameOf.get(leg.assigneeRef) ?? null) : null,
              address: leg.addressSnapshot ?? null,
              carrier: (leg.metadata as { carrier?: string } | null)?.carrier ?? null,
              trackingNumber: leg.trackingNumber,
              trackingUrl: leg.trackingUrl,
              shippedAt: leg.shippedAt,
              deliveredAt: leg.deliveredAt,
              canceledAt: leg.canceledAt,
              lastFailure: (leg.metadata as { lastFailure?: unknown } | null)?.lastFailure ?? null,
              attempts: Number((leg.metadata as { attempts?: number } | null)?.attempts ?? 0),
            }
          : null,
        nextTransitions: nextTransitions(aggregate),
        paymentLink: await s.paymentLink().summary(aggregate.order.id),
        settings: { delayMinutes: (await s.settings().get()).delayMinutes },
        editRevision: aggregate.order.editRevision ?? 0,
        editable: editState.editable,
        editableReason: editState.reason,
      };
    },

    /**
     * POST /orders/:id/transition — one step forward/back along the workflow. Acceptance sets
     * `estimatedReadyAt` (slot start, or now + preparation time for ASAP, plus `delayMinutes`);
     * rejection needs a reason; reaching a success terminal with money due must go through
     * cash-handover instead. Delivery leg moves (`out-for-delivery`, `failed`, `delivered`, a
     * `failed` → `ready` retry) delegate to delivery-assignment — they carry the assignee or
     * tracking and their own failure reason set. A concurrent winner leaves the loser with
     * INVALID_TRANSITION. Cancel is refused here: it refunds, so it goes through POST /cancel
     * and its own permission. Reject and expire still refund what was paid (a transfer stays
     * a `pending` refund row).
     */
    async transition(
      orderId: number,
      input: {
        to: string;
        note?: string;
        notifyCustomer?: boolean;
        delayMinutes?: number;
        reasonCode?: string;
        assigneeRef?: string;
        tracking?: unknown;
      },
      ctx: ServiceContext,
    ) {
      const note = input.note?.trim();
      if (note && note.length > MAX_NOTE) {
        throw new OrderingError('VALIDATION_ERROR', 'note is too long', { details: { field: 'note' } });
      }
      return strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
        const aggregate = await loadScoped(orderId, ctx);
        const group = liveGroup(aggregate);
        if (!group) throw new OrderingError('INVALID_TRANSITION', 'order has no active group');
        const definition = workflowOf(group);
        if (input.to === definition.cancelState) {
          throw new OrderingError('INVALID_TRANSITION', 'cancel the order with POST /cancel', {
            details: { to: input.to, use: 'cancel' },
          });
        }
        const terminal = isTerminal(definition, input.to);
        if (terminal === 'canceled' && !input.reasonCode && !note) {
          throw new OrderingError('VALIDATION_ERROR', 'a reason is required', {
            details: { field: 'reasonCode' },
          });
        }
        if (terminal === 'success' && paidAmounts(aggregate).due > 0) {
          throw new OrderingError('PAYMENT_REQUIRED', 'collect the payment with cash handover first', {
            details: { due: paidAmounts(aggregate).due },
          });
        }
        if (isDeliveryGroup(group)) {
          const leg = { note, notifyCustomer: input.notifyCustomer };
          const done = async (result: { from: string; to: string }) => ({
            from: result.from,
            to: result.to,
            detail: await service.detail(orderId, ctx),
          });
          if (input.to === 'out-for-delivery') {
            return done(
              await s
                .delivery()
                .dispatch(
                  orderId,
                  { assigneeRef: input.assigneeRef, tracking: input.tracking, ...leg },
                  ctx,
                ),
            );
          }
          if (input.to === 'failed') {
            return done(
              await s.delivery().markFailed(orderId, { reasonCode: input.reasonCode, ...leg }, ctx),
            );
          }
          if (input.to === 'delivered') {
            return done(await s.delivery().markDelivered(orderId, leg, ctx));
          }
          if (input.to === 'ready' && group.status === 'failed') {
            return done(await s.delivery().retry(orderId, leg, ctx));
          }
        }
        if (input.reasonCode) {
          const reasons = (await s.settings().get()).rejectReasons.map((item) => item.code);
          if (input.reasonCode !== 'other' && !reasons.includes(input.reasonCode)) {
            throw new OrderingError('VALIDATION_ERROR', 'unknown reason code', {
              details: { field: 'reasonCode' },
            });
          }
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
          const settings = isDeliveryGroup(group)
            ? s.branch().deliverySettings(branch ?? { fulfillment: null })
            : s.branch().pickupSettings(branch ?? { fulfillment: null });
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
        // Accept-then-pay paid before acceptance: nothing is owed, so do not wait for a transfer.
        if (result.to === 'awaiting-payment') await s.matching().advanceIfPaid(orderId, ctx);
        // A prepaid order rejected (or expired) by staff owes the customer their money back.
        const refunds =
          terminal === 'canceled'
            ? await refundHeld(trx, orderId, `${input.to}: ${input.reasonCode ?? note}`, ctx)
            : { refunded: 0, refundPending: 0 };
        return {
          from: result.from,
          to: result.to,
          ...refunds,
          detail: await service.detail(orderId, ctx),
        };
      });
    },

    /**
     * POST /orders/:id/cash-handover — "Thu tiền và giao" (contracts §19.3, §19.8): records the
     * cash for the amount due and moves the group to its success terminal in ONE transaction.
     * For a delivery order the courier collects at the door: the payment row names the assignee
     * (O6 settles per driver) and the leg's deliveredAt is stamped. A prepaid order has due 0 —
     * the same call just marks the leg delivered.
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
        const delivery = isDeliveryGroup(group);
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
          const paymentCtx = delivery ? await s.delivery().assigneeCtxFor(group.id, ctx) : ctx;
          const payment = await s
            .payment()
            .createPayment({ orderId, providerCode: 'cash', amount: due }, paymentCtx);
          await s.payment().capturePayment(
            {
              paymentId: payment.id,
              amount: due,
              providerTransactionId: `cash-handover:${orderId}:${randomUUID()}`,
            },
            paymentCtx,
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
        if (delivery) await s.delivery().completeLeg(group.id, ctx);
        return { collected, detail: await service.detail(orderId, ctx) };
      });
    },

    /**
     * POST /orders/:id/cancel — staff cancel. Captured cash still held is refunded through the
     * cash provider in the same transaction as the cancel (contracts §19.3). A captured transfer
     * (pickup or delivery, §19.8 — e.g. failed → hủy và hoàn) becomes a refund row that the
     * bank provider leaves `pending` for the settlement flow.
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
        const refunds = await refundHeld(trx, orderId, `cancel: ${reason}`, ctx);
        return { ...refunds, detail: await service.detail(orderId, ctx) };
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

    /** POST /orders/:id/lines/:lineId/cancel — partial cancel. Cash settles now; a transfer stays pending. */
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
     * POST /orders/:id/refunds { method: 'bank' }. The SePay provider leaves the refund pending.
     * `paymentStatus` stays put until settle. Pending refunds on the payment count against the cap.
     */
    async refundBank(
      orderId: number,
      input: { amount: number; reason?: string; idempotencyKey?: string },
      ctx: ServiceContext,
    ) {
      const aggregate = await loadScoped(orderId, ctx);
      const reason = input.reason?.trim() ?? '';
      if (!reason) {
        throw new OrderingError('VALIDATION_ERROR', 'refund reason is required', {
          details: { field: 'reason' },
        });
      }
      if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
        throw new OrderingError('VALIDATION_ERROR', 'refund amount must be a positive integer', {
          details: { field: 'amount' },
        });
      }
      let best: { id: number; room: number } | null = null;
      for (const payment of aggregate.payments) {
        if (payment.providerCode !== 'sepay') continue;
        const pending = await pendingRefundSum(strapi, payment.id);
        const room = payment.capturedAmount - payment.refundedAmount - pending;
        if (best === null || room > best.room) best = { id: payment.id, room };
      }
      if (!best || input.amount > best.room) {
        throw new OrderingError('REFUND_EXCEEDS_CAPTURED', 'no bank payment left to refund', {
          details: { max: Math.max(0, best?.room ?? 0) },
        });
      }
      const paymentId = best.id;
      const idempotencyKey = input.idempotencyKey ?? `admin-refund:${randomUUID()}`;
      await s.refund().createRefund(
        {
          paymentId,
          amount: input.amount,
          reason,
          idempotencyKey,
          audit: {
            locationRef: aggregate.order.locationRef,
            after: { amount: input.amount, method: 'bank', reason },
          },
        },
        ctx,
      );
      return service.detail(orderId, ctx);
    },

    /** POST /orders/:id/refunds. `method: 'bank'` waits for a reference; cash settles immediately. */
    async refundOrder(
      orderId: number,
      input: { method?: unknown; amount: number; reason?: string; idempotencyKey?: string },
      ctx: ServiceContext,
    ) {
      if (input.method === 'bank') return service.refundBank(orderId, input, ctx);
      if (input.method === undefined || input.method === 'cash') {
        return service.refundCash(orderId, input, ctx);
      }
      throw new OrderingError('VALIDATION_ERROR', 'method must be cash or bank', {
        details: { field: 'method' },
      });
    },

    /** POST /refunds/:id/settle. Out of scope is 404. Returns the order detail when the refund has one. */
    async settleRefund(
      refundId: number,
      input: { reference: unknown; settledAt?: unknown },
      ctx: ServiceContext,
    ) {
      const settled = await s.refund().settleRefund(refundId, input, ctx);
      if (settled.orderId === null) {
        return {
          ok: true,
          refundId: settled.refund.id,
          status: settled.refund.status,
          replayed: settled.replayed,
        };
      }
      return service.detail(settled.orderId, ctx);
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
