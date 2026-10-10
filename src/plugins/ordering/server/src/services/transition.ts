import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import { assertTransition, isPublicState, isTerminal } from '../domain/workflow/transition';
import orderRepository from '../repositories/order';
import type { OrderAggregate } from '../repositories/types';
import type { ServiceContext } from './context';
import { actorRefOf } from './context';
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
      input: { orderId: number; reason: string },
      ctx: ServiceContext,
    ): Promise<OrderAggregate> {
      if (!input.reason?.trim()) {
        throw new OrderingError('VALIDATION_ERROR', 'cancel reason is required');
      }
      const { order, hold } = services();
      const aggregate = await order.getOrder(input.orderId, ctx);
      for (const group of aggregate.groups) {
        const definition = (services().registry as OrderingRegistry).workflow(
          group.workflowName,
          group.workflowVersion,
        );
        if (isTerminal(definition, group.status) !== null) continue;
        await service.transitionGroup(
          { orderId: input.orderId, groupId: group.id, to: definition.cancelState, reason: input.reason },
          ctx,
        );
      }
      await hold.releaseForOrder(input.orderId, 'order-canceled', ctx);
      const result = await order.getOrder(input.orderId, ctx);
      return result;
    },

    /** Customer cancel: only while every non-terminal group is `customerCancellable`. */
    async customerCancel(
      input: { orderId: number; reason: string },
      ctx: ServiceContext,
    ): Promise<OrderAggregate> {
      if (!input.reason?.trim()) {
        throw new OrderingError('VALIDATION_ERROR', 'cancel reason is required');
      }
      const { order, registry } = services();
      const aggregate = await order.getOrder(input.orderId, ctx);
      for (const group of aggregate.groups) {
        const definition = registry.workflow(group.workflowName, group.workflowVersion);
        if (isTerminal(definition, group.status) !== null) continue;
        if (!definition.states[group.status]?.customerCancellable) {
          throw new OrderingError(
            'INVALID_TRANSITION',
            `group state "${group.status}" is not customer-cancellable`,
            { details: { groupId: group.id, status: group.status } },
          );
        }
      }
      return service.cancelOrder(input, ctx);
    },
  };

  return service;
};

export default transition;
