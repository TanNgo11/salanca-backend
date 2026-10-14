import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import { assertTransition, isPublicState, isTerminal } from '../domain/workflow/transition';
import orderRepository from '../repositories/order';
import type { OrderAggregate } from '../repositories/types';
import type { ServiceContext } from './context';
import { actorRefOf, nowOf } from './context';
import type { TransactionClient } from '../migrations/runner';
import type dailyStockFactory from './daily-stock';
import type holdFactory from './hold';
import type orderServiceFactory from './order';
import type outboxFactory from './outbox';
import type scopeFactory from './scope';
import type timelineFactory from './timeline';
import type { OrderingRegistry } from './registry';

type Services = {
  registry: OrderingRegistry;
  scope: ReturnType<typeof scopeFactory>;
  order: ReturnType<typeof orderServiceFactory>;
  timeline: ReturnType<typeof timelineFactory>;
  hold: ReturnType<typeof holdFactory>;
  outbox: ReturnType<typeof outboxFactory>;
  dailyStock: ReturnType<typeof dailyStockFactory>;
};

type GroupRow = {
  id: number;
  order: number;
  status: string;
  workflowName: string;
  workflowVersion: string;
};

/**
 * Fulfillment-group transitions: the group's row is locked FOR UPDATE, the edge is validated
 * against its registered workflow, terminal-canceled releases the group's holds, and the
 * order-level projection is recomputed (emitting `order.transitioned` when it really changed).
 */
const transition = ({ strapi }: { strapi: Core.Strapi }) => {
  const services = (): Services => {
    const plugin = strapi.plugin('ordering');
    return {
      registry: plugin.service('registry') as Services['registry'],
      scope: plugin.service('scope') as Services['scope'],
      order: plugin.service('order') as Services['order'],
      timeline: plugin.service('timeline') as Services['timeline'],
      hold: plugin.service('hold') as Services['hold'],
      outbox: plugin.service('outbox') as Services['outbox'],
      dailyStock: plugin.service('daily-stock') as Services['dailyStock'],
    };
  };
  const repo = orderRepository({ strapi });

  const groups = () => strapi.db.query('plugin::ordering.fulfillment-group');

  const service = {
    async transitionGroup(
      input: {
        orderId: number;
        groupId: number;
        to: string;
        reason?: string;
        payload?: Record<string, unknown>;
        /** Customer email for this step; defaults to the state's `isPublic`. */
        notifyCustomer?: boolean;
      },
      ctx: ServiceContext,
    ): Promise<{ from: string; to: string; order: OrderAggregate }> {
      return strapi.db.transaction(async ({ trx }) => {
        const { registry, scope, order, timeline, hold, outbox } = services();
        const row = await repo.findOrderById(input.orderId);
        if (!row) {
          throw new OrderingError('ORDER_NOT_FOUND', 'order not found', {
            details: { orderId: input.orderId },
          });
        }
        if (ctx.actor.kind === 'staff') {
          scope.assertLocationInScope(await scope.loadScope(ctx), row.locationRef);
        }
        const group = (await groups().findOne({
          where: { id: input.groupId, order: input.orderId },
        })) as GroupRow | null;
        if (!group) {
          throw new OrderingError('ORDER_NOT_FOUND', 'fulfillment group not found for order', {
            details: { groupId: input.groupId },
          });
        }
        const locked = await repo.lockGroup(trx, input.groupId);
        const from = (locked as { status: string }).status;
        const definition = registry.workflow(group.workflowName, group.workflowVersion);
        assertTransition(definition, from, input.to);

        await groups().update({ where: { id: input.groupId }, data: { status: input.to } });
        if (isTerminal(definition, input.to) === 'canceled') {
          await hold.releaseForGroup(input.groupId, 'group-canceled', ctx);
          // Cancel, reject, and payment expiry all land here. Releasing the order is
          // idempotent, so a later group of the same cancel is a no-op. A completed
          // group never takes this branch. Mixed-workflow orders are off unless
          // allowMixedProductTypes is set; the first canceled group then returns every
          // portion of the order.
          await services().dailyStock.releaseForOrder(
            trx as TransactionClient,
            input.orderId,
            'group-canceled',
          );
          // A canceled group cancels its open fulfillment rows too (O5 delivery legs); a row
          // already delivered or canceled is left alone. Pickup groups have no rows — no-op.
          const legs = (await strapi.db.query('plugin::ordering.fulfillment').findMany({
            where: { group: input.groupId },
            select: ['id', 'status'],
          })) as Array<{ id: number; status: string }>;
          for (const leg of legs) {
            if (leg.status === 'delivered' || leg.status === 'canceled') continue;
            await strapi.db.query('plugin::ordering.fulfillment').update({
              where: { id: leg.id },
              data: { status: 'canceled', canceledAt: nowOf(ctx) },
            });
          }
        }
        await timeline.record(
          {
            orderId: input.orderId,
            type: 'fulfillment-group.transitioned',
            isPublic: isPublicState(definition, input.to),
            payload: {
              groupId: input.groupId,
              from,
              to: input.to,
              workflowName: group.workflowName,
              workflowVersion: group.workflowVersion,
              reason: input.reason,
              ...(input.payload ?? {}),
            },
          },
          ctx,
        );
        const projection = await order.recomputeProjection(input.orderId);
        await outbox.enqueue(
          {
            type: 'fulfillment-group.transitioned',
            aggregateType: 'fulfillment-group',
            aggregateId: String(input.groupId),
            payload: {
              orderId: input.orderId,
              groupId: input.groupId,
              from,
              to: input.to,
              workflowName: group.workflowName,
              workflowVersion: group.workflowVersion,
              actorRef: actorRefOf(ctx),
              isPublic: isPublicState(definition, input.to),
              notifyCustomer: input.notifyCustomer ?? isPublicState(definition, input.to),
              locationRef: row.locationRef,
              delayed: Boolean(input.payload?.delayMinutes),
              ...(input.reason ? { reasonCode: input.reason } : {}),
            },
            uniqueKey: `fgt:${input.groupId}:${from}>${input.to}:${randomUUID()}`,
          },
          ctx,
        );
        if (projection.before.status !== projection.after.status) {
          await outbox.enqueue(
            {
              type: 'order.transitioned',
              aggregateType: 'order',
              aggregateId: String(input.orderId),
              payload: {
                orderId: input.orderId,
                from: projection.before.status,
                to: projection.after.status,
                actorRef: actorRefOf(ctx),
                locationRef: row.locationRef,
              },
              uniqueKey: `order.transitioned:${input.orderId}:${randomUUID()}`,
            },
            ctx,
          );
        }
        const aggregate = await repo.loadOrderAggregate(input.orderId);
        return { from, to: input.to, order: aggregate as OrderAggregate };
      });
    },

    /** Cancels every non-terminal group to its workflow's cancelState, then releases holds. */
    async cancelOrder(
      input: { orderId: number; reason: string; payload?: Record<string, unknown> },
      ctx: ServiceContext,
    ): Promise<OrderAggregate> {
      if (!input.reason?.trim()) {
        throw new OrderingError('VALIDATION_ERROR', 'cancel reason is required');
      }
      const { order, hold } = services();
      // One outer transaction: every group cancels and the holds release together, or nothing
      // changes (nested strapi.db.transaction calls reuse it).
      return strapi.db.transaction(async () => {
        const aggregate = await order.getOrder(input.orderId, ctx);
        for (const group of aggregate.groups) {
          const definition = (services().registry as OrderingRegistry).workflow(
            group.workflowName,
            group.workflowVersion,
          );
          if (isTerminal(definition, group.status) !== null) continue;
          await service.transitionGroup(
            {
              orderId: input.orderId,
              groupId: group.id,
              to: definition.cancelState,
              reason: input.reason,
              payload: input.payload,
            },
            ctx,
          );
        }
        await hold.releaseForOrder(input.orderId, 'order-canceled', ctx);
        return order.getOrder(input.orderId, ctx);
      });
    },

    /**
     * Customer cancel: only while every non-terminal group is `customerCancellable`. `guard` runs
     * on a fresh read once the groups are locked (the storefront checks its cancel window there,
     * so a concurrent staff edit of the slot cannot slip past a check made before the lock).
     */
    async customerCancel(
      input: {
        orderId: number;
        reason: string;
        guard?: (aggregate: OrderAggregate) => Promise<void> | void;
      },
      ctx: ServiceContext,
    ): Promise<OrderAggregate> {
      if (!input.reason?.trim()) {
        throw new OrderingError('VALIDATION_ERROR', 'cancel reason is required');
      }
      return strapi.db.transaction(async ({ trx }) => {
        const { order, registry } = services();
        const aggregate = await order.getOrder(input.orderId, ctx);
        // Lock in stable order before checking any state; keep every lock through cancellation.
        for (const group of [...aggregate.groups].sort((a, b) => a.id - b.id)) {
          const locked = await repo.lockGroup(trx, group.id);
          if (!locked) throw new OrderingError('ORDER_NOT_FOUND', 'fulfillment group not found');
          const status = (locked as { status: string }).status;
          const definition = registry.workflow(group.workflowName, group.workflowVersion);
          if (isTerminal(definition, status) !== null) continue;
          if (!definition.states[status]?.customerCancellable) {
            throw new OrderingError(
              'INVALID_TRANSITION',
              `group state "${status}" is not customer-cancellable`,
              { details: { groupId: group.id, status } },
            );
          }
        }
        if (input.guard) await input.guard(await services().order.getOrder(input.orderId, ctx));
        const canceled = await service.cancelOrder(
          { orderId: input.orderId, reason: input.reason },
          ctx,
        );
        // A customer may cancel after paying (prepay transfer, test provider): give the money
        // back in the same transaction, exactly like a staff cancel.
        await (
          strapi.plugin('ordering').service('admin-orders') as {
            refundHeldInTransaction(
              trx: TransactionClient,
              orderId: number,
              reason: string,
              ctx: ServiceContext,
            ): Promise<{ refunded: number; refundPending: number }>;
          }
        ).refundHeldInTransaction(trx as TransactionClient, input.orderId, `customer-cancel: ${input.reason}`, ctx);
        return (await services().order.getOrder(input.orderId, ctx)) ?? canceled;
      });
    },
  };

  return service;
};

export default transition;
