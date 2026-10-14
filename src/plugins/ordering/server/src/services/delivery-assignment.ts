import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import { resolveScope, scopeIncludes, type StoredScopeRow } from '../domain/scope';
import { isTerminal } from '../domain/workflow/transition';
import type { ServiceContext } from './context';
import { nowOf } from './context';
import type orderServiceFactory from './order';
import type scopeFactory from './scope';
import type transitionFactory from './transition';
import type { OrderingRegistry } from './registry';

type Services = {
  registry: OrderingRegistry;
  order: ReturnType<typeof orderServiceFactory>;
  scope: ReturnType<typeof scopeFactory>;
  transition: ReturnType<typeof transitionFactory>;
};

/** Reason codes for a failed delivery attempt (screens D3); `other` must carry a note. */
export const DELIVERY_FAILURE_REASONS = ['unreachable', 'wrong-address', 'refused', 'other'] as const;
export type DeliveryFailureReason = (typeof DELIVERY_FAILURE_REASONS)[number];

const ASSIGNEE_REF = /^admin:(\d+)$/;
const MAX_TEXT = 200;

export type DeliveryTracking = { carrier?: string; number?: string; url?: string };

type FulfillmentRow = {
  id: number;
  status: string;
  assigneeRef: string | null;
  metadata: Record<string, unknown> | null;
};

type AdminUserRow = {
  id: number;
  firstname?: string | null;
  lastname?: string | null;
  isActive?: boolean;
  roles?: Array<{ code?: string }>;
};

/** Whether this fulfillment group is a delivery leg (`receiveMethod.kind === 'delivery'`). */
export const isDeliveryGroup = (group: { receiveMethod: unknown }): boolean =>
  (group.receiveMethod as { kind?: unknown } | null | undefined)?.kind === 'delivery';

/**
 * The self-delivery leg (contracts §19.8; screens D3): dispatch assigns the courier or records an
 * external vehicle, `delivered` closes the leg, a failed attempt needs a reason and either retries
 * through `ready` (assignee cleared) or cancels. Every leg move goes through `transitionGroup`,
 * which locks the group row before the edge check — two staff cannot dispatch the same order twice.
 */
const deliveryAssignment = ({ strapi }: { strapi: Core.Strapi }) => {
  const services = (): Services => {
    const plugin = strapi.plugin('ordering');
    return {
      registry: plugin.service('registry') as Services['registry'],
      order: plugin.service('order') as Services['order'],
      scope: plugin.service('scope') as Services['scope'],
      transition: plugin.service('transition') as Services['transition'],
    };
  };
  const fulfillments = () => strapi.db.query('plugin::ordering.fulfillment');

  /** The live delivery group of a scoped order; out of scope is ORDER_NOT_FOUND via getOrder. */
  const liveDeliveryGroup = async (orderId: number, ctx: ServiceContext) => {
    const { order, registry } = services();
    const aggregate = await order.getOrder(orderId, ctx);
    const group =
      aggregate.groups.find(
        (candidate) =>
          isDeliveryGroup(candidate) &&
          isTerminal(
            registry.workflow(candidate.workflowName, candidate.workflowVersion),
            candidate.status,
          ) === null,
      ) ?? null;
    if (!group) {
      throw new OrderingError('INVALID_TRANSITION', 'order has no active delivery group', {
        details: { orderId },
      });
    }
    return { aggregate, group };
  };

  const fulfillmentOf = (groupId: number) =>
    fulfillments().findOne({ where: { group: groupId } }) as Promise<FulfillmentRow | null>;

  const text = (value: unknown, field: string): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_TEXT) {
      throw new OrderingError('VALIDATION_ERROR', `${field} must be 1–${MAX_TEXT} characters`, {
        details: { field },
      });
    }
    return value.trim();
  };

  const trackingOf = (raw: unknown): DeliveryTracking => {
    const input =
      typeof raw === 'object' && raw !== null && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const carrier = text(input.carrier, 'tracking.carrier');
    const number = text(input.number, 'tracking.number');
    const url = text(input.url, 'tracking.url');
    if (url !== undefined) {
      try {
        new URL(url);
      } catch {
        throw new OrderingError('VALIDATION_ERROR', 'tracking url must be a valid URL', {
          details: { field: 'tracking.url' },
        });
      }
    }
    return { carrier, number, url };
  };

  /** `admin:<id>` of an active staff member whose location scope covers the branch. */
  const assertAssignee = async (ref: unknown, locationRef: string): Promise<string> => {
    const match = typeof ref === 'string' ? ASSIGNEE_REF.exec(ref) : null;
    if (!match) {
      throw new OrderingError('VALIDATION_ERROR', 'assigneeRef must look like admin:<id>', {
        details: { field: 'assigneeRef' },
      });
    }
    const adminUserId = Number(match[1]);
    const user = (await strapi.db.query('admin::user').findOne({
      where: { id: adminUserId },
      populate: { roles: { select: ['code'] } },
    })) as AdminUserRow | null;
    if (!user || user.isActive === false) {
      throw new OrderingError('VALIDATION_ERROR', 'assignee is not an active staff member', {
        details: { field: 'assigneeRef' },
      });
    }
    const isSuperAdmin = (user.roles ?? []).some((role) => role.code === 'strapi-super-admin');
    const scopeRow = (await strapi.db
      .query('plugin::ordering.staff-location-scope')
      .findOne({ where: { adminUserId } })) as StoredScopeRow;
    if (!scopeIncludes(resolveScope(scopeRow, { isSuperAdmin }), locationRef)) {
      throw new OrderingError('VALIDATION_ERROR', 'assignee is outside this branch', {
        details: { field: 'assigneeRef' },
      });
    }
    return `admin:${adminUserId}`;
  };

  /** Fulfillment bookkeeping for a leg that just reached its success terminal. */
  const completeLeg = async (groupId: number, ctx: ServiceContext) => {
    const fulfillment = await fulfillmentOf(groupId);
    if (fulfillment) {
      await fulfillments().update({
        where: { id: fulfillment.id },
        data: { status: 'delivered', deliveredAt: nowOf(ctx) },
      });
    }
  };

  return {
    completeLeg,

    /** Staff members the assign combobox may offer for a branch (screens D3). */
    async assignableStaff(locationRef: string, ctx: ServiceContext) {
      if (!locationRef) {
        throw new OrderingError('VALIDATION_ERROR', 'branch is required', {
          details: { field: 'branch' },
        });
      }
      const { scope } = services();
      const viewer = await scope.loadScope(ctx);
      if (viewer === null) {
        throw new OrderingError('SCOPE_REQUIRED', 'staff member has no location scope');
      }
      if (!scopeIncludes(viewer, locationRef)) {
        throw new OrderingError('ORDER_NOT_FOUND', 'order not found', {
          details: { locationRef },
        });
      }
      const users = (await strapi.db.query('admin::user').findMany({
        select: ['id', 'firstname', 'lastname', 'isActive'],
        populate: { roles: { select: ['code'] } },
        orderBy: { id: 'asc' },
      })) as AdminUserRow[];
      const scopeRows = (await strapi.db.query('plugin::ordering.staff-location-scope').findMany({})) as Array<{
        adminUserId: number;
        allLocations?: unknown;
        locationRefs?: unknown;
      }>;
      const byUser = new Map(scopeRows.map((row) => [row.adminUserId, row]));
      return users
        .filter((user) => user.isActive !== false)
        .filter((user) => {
          const isSuperAdmin = (user.roles ?? []).some((role) => role.code === 'strapi-super-admin');
          return scopeIncludes(
            resolveScope(byUser.get(user.id) ?? null, { isSuperAdmin }),
            locationRef,
          );
        })
        .map((user) => ({
          ref: `admin:${user.id}`,
          name: [user.firstname, user.lastname].filter(Boolean).join(' ') || `admin:${user.id}`,
        }));
    },

    /**
     * `ready` → `out-for-delivery`: assigns a staff driver (`admin:<id>`) or records an external
     * vehicle (carrier + tracking). One of the two is required so the board always knows who
     * carries the order. A concurrent dispatch loses with INVALID_TRANSITION on the group lock.
     */
    async dispatch(
      orderId: number,
      input: {
        assigneeRef?: string;
        tracking?: unknown;
        note?: string;
        notifyCustomer?: boolean;
      },
      ctx: ServiceContext,
    ) {
      const tracking = trackingOf(input.tracking);
      const note = text(input.note, 'note');
      return strapi.db.transaction(async () => {
        const { aggregate, group } = await liveDeliveryGroup(orderId, ctx);
        const assigneeRef =
          input.assigneeRef === undefined || input.assigneeRef === null
            ? null
            : await assertAssignee(input.assigneeRef, aggregate.order.locationRef);
        if (assigneeRef === null && !tracking.carrier) {
          throw new OrderingError('VALIDATION_ERROR', 'assign a staff driver or an external vehicle', {
            details: { field: 'assigneeRef' },
          });
        }
        const result = await services().transition.transitionGroup(
          {
            orderId,
            groupId: group.id,
            to: 'out-for-delivery',
            notifyCustomer: input.notifyCustomer,
            payload: {
              ...(assigneeRef ? { assigneeRef } : {}),
              ...(tracking.carrier ? { carrier: tracking.carrier } : {}),
              ...(tracking.number ? { trackingNumber: tracking.number } : {}),
              ...(note ? { note } : {}),
            },
          },
          ctx,
        );
        const fulfillment = await fulfillmentOf(group.id);
        if (fulfillment) {
          await fulfillments().update({
            where: { id: fulfillment.id },
            data: {
              status: 'out-for-delivery',
              assigneeRef,
              trackingNumber: tracking.number ?? null,
              trackingUrl: tracking.url ?? null,
              shippedAt: nowOf(ctx),
              metadata: {
                ...(fulfillment.metadata ?? {}),
                ...(tracking.carrier ? { carrier: tracking.carrier } : {}),
              },
            },
          });
        }
        return { from: result.from, to: result.to };
      });
    },

    /** `out-for-delivery` → `delivered` for prepaid or already-collected orders. */
    async markDelivered(
      orderId: number,
      input: { note?: string; notifyCustomer?: boolean },
      ctx: ServiceContext,
    ) {
      const note = text(input.note, 'note');
      return strapi.db.transaction(async () => {
        const { group } = await liveDeliveryGroup(orderId, ctx);
        const result = await services().transition.transitionGroup(
          {
            orderId,
            groupId: group.id,
            to: 'delivered',
            notifyCustomer: input.notifyCustomer,
            payload: note ? { note } : {},
          },
          ctx,
        );
        await completeLeg(group.id, ctx);
        return { from: result.from, to: result.to };
      });
    },

    /**
     * `out-for-delivery` → `failed`. The reason rides the transition timeline entry and the
     * fulfillment metadata (`lastFailure`); no new column (plan step 5).
     */
    async markFailed(
      orderId: number,
      input: { reasonCode?: string; note?: string; notifyCustomer?: boolean },
      ctx: ServiceContext,
    ) {
      const reason = input.reasonCode ?? '';
      if (!(DELIVERY_FAILURE_REASONS as readonly string[]).includes(reason)) {
        throw new OrderingError('VALIDATION_ERROR', 'unknown delivery failure reason', {
          details: { field: 'reasonCode', allowed: [...DELIVERY_FAILURE_REASONS] },
        });
      }
      const note = text(input.note, 'note');
      if (reason === 'other' && !note) {
        throw new OrderingError('VALIDATION_ERROR', 'a note is required when the reason is "other"', {
          details: { field: 'note' },
        });
      }
      return strapi.db.transaction(async () => {
        const { group } = await liveDeliveryGroup(orderId, ctx);
        const result = await services().transition.transitionGroup(
          {
            orderId,
            groupId: group.id,
            to: 'failed',
            reason,
            notifyCustomer: input.notifyCustomer,
            payload: { reasonCode: reason, ...(note ? { note } : {}) },
          },
          ctx,
        );
        const fulfillment = await fulfillmentOf(group.id);
        if (fulfillment) {
          await fulfillments().update({
            where: { id: fulfillment.id },
            data: {
              status: 'failed',
              metadata: {
                ...(fulfillment.metadata ?? {}),
                lastFailure: {
                  reasonCode: reason,
                  ...(note ? { note } : {}),
                  at: nowOf(ctx).toISOString(),
                },
              },
            },
          });
        }
        return { from: result.from, to: result.to };
      });
    },

    /** `failed` → `ready`: the assignee is cleared; dispatching again re-assigns. */
    async retry(
      orderId: number,
      input: { note?: string; notifyCustomer?: boolean },
      ctx: ServiceContext,
    ) {
      const note = text(input.note, 'note');
      return strapi.db.transaction(async () => {
        const { group } = await liveDeliveryGroup(orderId, ctx);
        const result = await services().transition.transitionGroup(
          {
            orderId,
            groupId: group.id,
            to: 'ready',
            notifyCustomer: input.notifyCustomer,
            payload: note ? { note } : {},
          },
          ctx,
        );
        const fulfillment = await fulfillmentOf(group.id);
        if (fulfillment) {
          const metadata = { ...(fulfillment.metadata ?? {}) };
          delete metadata.carrierDriver;
          await fulfillments().update({
            where: { id: fulfillment.id },
            data: {
              status: 'pending',
              assigneeRef: null,
              trackingNumber: null,
              trackingUrl: null,
              shippedAt: null,
              // O13: a dead carrier trip must not block "Gọi lại" — the ref is history now
              // (metadata.carrierTrips), so booking a fresh trip can write a new one.
              providerReference: null,
              carrierStatus: null,
              carrierFee: null,
              metadata: { ...metadata, carrier: null, attempts: Number(metadata.attempts ?? 0) + 1 },
            },
          });
        }
        return { from: result.from, to: result.to };
      });
    },

    /**
     * The cash ledger for a door collection names the courier, not the staff pressing the button
     * (O6 settles per driver). An external vehicle has no assignee, so the acting staff stays the
     * actor. Only `actorRef` is overridden — scope checks still run as the acting staff.
     */
    async assigneeCtxFor(groupId: number, ctx: ServiceContext): Promise<ServiceContext> {
      const fulfillment = await fulfillmentOf(groupId);
      const ref = fulfillment?.assigneeRef;
      if (!ref || !ASSIGNEE_REF.test(ref)) return ctx;
      return { ...ctx, actor: { ...ctx.actor, actorRef: ref } };
    },
  };
};

export default deliveryAssignment;
