import type { Core } from '@strapi/strapi';

import type { AddressSnapshot } from '../contracts/common';
import { businessDate } from '../domain/business-date';
import { OrderingError } from '../domain/errors';
import { scopeIncludes } from '../domain/scope';
import { paidAmounts } from '../domain/storefront/serialize';
import orderRepository from '../repositories/order';
import type { OrderAggregate } from '../repositories/types';
import type branchFactory from './branch';
import type { ServiceContext } from './context';
import { actorRefOf, nowOf } from './context';
import type scopeFactory from './scope';

/**
 * A courier is only attached to a leg when it is dispatched (out-for-delivery); a `ready` order has
 * no assignee yet (and a retry clears it), so the phone page lists the legs in hand and today's
 * delivered ones. Dispatch stays a manager action on the delivery board.
 */
const ACTIVE = new Set(['out-for-delivery', 'failed']);
const LISTED = [...ACTIVE, 'delivered'];
const PREFIX = 'plugin::ordering.';

export type CourierView = 'active' | 'done';

export type CourierDelivery = {
  id: number;
  code: string;
  status: string;
  slotStartsAt: string | null;
  address: string;
  mapQuery: string;
  recipientName: string;
  phone: string | null;
  customerName: string | null;
  note: string | null;
  items: Array<{ title: string; quantity: number }>;
  due: number;
};

export type CourierList = {
  actorName: string;
  actorRef: string;
  /** Business dates of the branches this courier can see, usually one. */
  dates: string[];
  counts: { active: number; done: number };
  orders: CourierDelivery[];
};

const relationId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = (value as { id: unknown }).id;
    return typeof id === 'number' && Number.isInteger(id) ? id : null;
  }
  return null;
};

const dayOf = (value: unknown): string => {
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  return '';
};

/**
 * Phone page for the assigned courier (screens E4). A courier without `order.read` only ever
 * receives rows whose fulfillment assignee is themselves, and only for today's business date
 * at that branch. `assertOwnOrder` is the same rule on cash-handover and transition.
 */
const courier = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ordering');
  const scope = () => plugin().service('scope') as ReturnType<typeof scopeFactory>;
  const branches = () => plugin().service('branch') as ReturnType<typeof branchFactory>;
  const repo = orderRepository({ strapi });

  /**
   * Plugin actions on the actor's roles. `null` means unrestricted (not staff, or super admin).
   * An empty set means the actor has no ordering role — service-level test users — and is also
   * left unrestricted. A real courier role holds actions and lacks `order.read`.
   */
  const actionsOf = async (ctx: ServiceContext): Promise<Set<string> | null> => {
    if (ctx.actor.kind !== 'staff' || ctx.actor.isSuperAdmin) return null;
    const rows = (await strapi.db.query('admin::permission').findMany({
      where: {
        action: { $startsWith: PREFIX },
        role: { users: { id: ctx.actor.adminUserId } },
      },
      select: ['action'],
    })) as Array<{ action: string }>;
    return new Set(rows.map((row) => row.action.slice(PREFIX.length)));
  };

  const courierOnly = async (ctx: ServiceContext): Promise<boolean> => {
    const actions = await actionsOf(ctx);
    if (actions === null || actions.size === 0 || actions.has('order.read')) return false;
    return true;
  };

  return {
    /**
     * Cash-handover and transition: a courier who cannot read the whole branch may touch only
     * a delivery assigned to them. Anyone else keeps the existing location-scope check.
     * Missing or not-mine both answer ORDER_NOT_FOUND.
     */
    async assertOwnOrder(orderId: number, ctx: ServiceContext): Promise<void> {
      if (!(await courierOnly(ctx))) return;
      const ref = actorRefOf(ctx);
      const legs = (await strapi.db.query('plugin::ordering.fulfillment').findMany({
        where: { order: orderId },
        select: ['assigneeRef'],
      })) as Array<{ assigneeRef: string | null }>;
      if (!legs.some((leg) => leg.assigneeRef === ref)) {
        throw new OrderingError('ORDER_NOT_FOUND', 'order not found');
      }
    },

    /** GET /courier/deliveries?view=active|done */
    async myDeliveries(ctx: ServiceContext, view: CourierView): Promise<CourierList> {
      if (view !== 'active' && view !== 'done') {
        throw new OrderingError('VALIDATION_ERROR', 'view must be active or done', {
          details: { field: 'view' },
        });
      }
      const staffScope = await scope().loadScope(ctx);
      if (staffScope === null) {
        throw new OrderingError('SCOPE_REQUIRED', 'staff member has no location scope');
      }
      const visible = (await branches().list()).filter((row) => scopeIncludes(staffScope, row.code));
      const todayOf = new Map<string, string>();
      for (const row of visible) {
        const cutoff = branches().deliverySettings(row).schedule.businessDayPolicy.cutoffLocalTime;
        todayOf.set(row.code, businessDate(nowOf(ctx), row.timezone || 'Asia/Ho_Chi_Minh', cutoff));
      }
      const ref = actorRefOf(ctx);
      const dates = [...new Set(todayOf.values())];
      if (dates.length === 0) {
        return { actorName: await nameOf(strapi, ctx), actorRef: ref, dates, counts: { active: 0, done: 0 }, orders: [] };
      }
      // Narrowed in SQL (today's business dates, listed statuses) — a courier's history grows
      // every day and the page refreshes every 30 s.
      const legs = (await strapi.db.query('plugin::ordering.fulfillment').findMany({
        where: {
          assigneeRef: ref,
          group: { status: { $in: LISTED } },
          order: { businessDate: { $in: dates } },
        },
        limit: 200,
        populate: {
          order: { select: ['id', 'businessDate', 'locationRef'] },
          group: { select: ['id', 'status'] },
        },
      })) as Array<{
        order: unknown;
        group: unknown;
        addressSnapshot: unknown;
      }>;
      const active: CourierDelivery[] = [];
      const done: CourierDelivery[] = [];
      const seen = new Set<number>();
      for (const leg of legs) {
        const orderId = relationId(leg.order);
        const groupId = relationId(leg.group);
        if (orderId === null || seen.has(orderId)) continue;
        seen.add(orderId);
        const aggregate = await repo.loadOrderAggregate(orderId);
        if (!aggregate) continue;
        const today = todayOf.get(aggregate.order.locationRef);
        if (!today || dayOf(aggregate.order.businessDate) !== today) continue;
        const group =
          aggregate.groups.find((candidate) => candidate.id === groupId) ?? aggregate.groups[0];
        if (!group) continue;
        const bucket = ACTIVE.has(group.status) ? active : group.status === 'delivered' ? done : null;
        if (!bucket) continue;
        bucket.push(cardOf(aggregate, group.status, leg.addressSnapshot));
      }
      const bySlot = (left: CourierDelivery, right: CourierDelivery) => {
        if (left.slotStartsAt && right.slotStartsAt) return left.slotStartsAt.localeCompare(right.slotStartsAt);
        if (left.slotStartsAt) return -1;
        if (right.slotStartsAt) return 1;
        return left.id - right.id;
      };
      active.sort(bySlot);
      done.sort(bySlot);
      const actorName = await nameOf(strapi, ctx);
      return {
        actorName,
        actorRef: ref,
        dates,
        counts: { active: active.length, done: done.length },
        orders: view === 'done' ? done : active,
      };
    },
  };
};

const cardOf = (aggregate: OrderAggregate, status: string, snapshot: unknown): CourierDelivery => {
  const contact = aggregate.order.contactSnapshot as { name?: unknown; phone?: unknown };
  const address =
    snapshot !== null && typeof snapshot === 'object' ? (snapshot as AddressSnapshot) : ({} as AddressSnapshot);
  const line = [address.line1, address.wardName, address.provinceName].filter(Boolean).join(', ');
  const contactPhone = typeof contact.phone === 'string' && contact.phone !== '' ? contact.phone : null;
  const receive = aggregate.order.receiveMethod as {
    timing?: { slot?: { startsAt?: string } };
  };
  return {
    id: aggregate.order.id,
    code: aggregate.order.code,
    status,
    slotStartsAt: receive.timing?.slot?.startsAt ?? null,
    address: line,
    mapQuery: line,
    recipientName: address.recipientName ?? '',
    phone: contactPhone ?? (typeof address.phone === 'string' && address.phone !== '' ? address.phone : null),
    customerName: typeof contact.name === 'string' && contact.name !== '' ? contact.name : null,
    note: aggregate.order.customerNote,
    items: aggregate.lines
      .map((item) => ({
        title: typeof item.titleSnapshot === 'string' ? item.titleSnapshot : '',
        quantity: item.quantity - item.canceledQuantity,
      }))
      .filter((item) => item.quantity > 0 && item.title !== ''),
    due: paidAmounts(aggregate).due,
  };
};

const nameOf = async (strapi: Core.Strapi, ctx: ServiceContext): Promise<string> => {
  if (ctx.actor.kind !== 'staff') return actorRefOf(ctx);
  const user = (await strapi.db.query('admin::user').findOne({
    where: { id: ctx.actor.adminUserId },
    select: ['firstname', 'lastname'],
  })) as { firstname?: string | null; lastname?: string | null } | null;
  const name = [user?.firstname, user?.lastname].filter(Boolean).join(' ');
  return name || actorRefOf(ctx);
};

export default courier;
