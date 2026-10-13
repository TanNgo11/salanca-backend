import type { Core } from '@strapi/strapi';

import { isOrderingError } from '../domain/errors';
import type kitchenFactory from '../services/kitchen';
import type scopeFactory from '../services/scope';

interface AdminCtx {
  query: Record<string, unknown>;
  params: Record<string, string | undefined>;
  state: { user?: { id?: number; roles?: { code?: string }[] } };
  request: { body?: unknown };
  status: number;
  body: unknown;
}

/**
 * KDS routes (O12 plan step 6, screens N2) behind `kitchen.read`: the board listing, the
 * per-line prepared toggle, and "Xong cả đơn" → `ready` (the workflow edge answers 409
 * when the group already moved). SSE comes from `/orders/stream` — the inbox route
 * already filters events by the viewer's location scope.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const actorCtx = async (ctx: AdminCtx) => {
    const scope = strapi.plugin('ordering').service('scope') as ReturnType<typeof scopeFactory>;
    return { actor: await scope.actorFromAdminUser(ctx.state.user ?? {}) };
  };
  const fail = (ctx: AdminCtx, error: unknown) => {
    if (isOrderingError(error)) {
      ctx.status = error.status;
      ctx.body = { error: { code: error.code, message: error.message, details: error.details } };
      return true;
    }
    return false;
  };

  return {
    async board(ctx: AdminCtx) {
      try {
        const service = strapi.plugin('ordering').service('kitchen') as ReturnType<typeof kitchenFactory>;
        const branch = typeof ctx.query.branch === 'string' ? ctx.query.branch : '';
        const station = typeof ctx.query.station === 'string' ? ctx.query.station : undefined;
        ctx.body = { item: await service.board(branch, station, await actorCtx(ctx)) };
      } catch (error) {
        if (!fail(ctx, error)) throw error;
      }
    },

    async prepared(ctx: AdminCtx) {
      try {
        const service = strapi.plugin('ordering').service('kitchen') as ReturnType<typeof kitchenFactory>;
        const lineId = Number(ctx.params.lineId);
        const prepared = (ctx.request.body as { prepared?: unknown } | undefined)?.prepared;
        if (!Number.isInteger(lineId) || lineId <= 0 || typeof prepared !== 'boolean') {
          ctx.status = typeof prepared === 'boolean' ? 404 : 400;
          ctx.body = {
            error: {
              code: typeof prepared === 'boolean' ? 'ORDER_NOT_FOUND' : 'VALIDATION_ERROR',
              message: typeof prepared === 'boolean' ? 'order not found' : 'prepared must be a boolean',
            },
          };
          return;
        }
        ctx.body = { item: await service.setLinePrepared(lineId, prepared, await actorCtx(ctx)) };
      } catch (error) {
        if (!fail(ctx, error)) throw error;
      }
    },

    async start(ctx: AdminCtx) {
      try {
        const service = strapi.plugin('ordering').service('kitchen') as ReturnType<typeof kitchenFactory>;
        const orderId = Number(ctx.params.id);
        if (!Number.isInteger(orderId) || orderId <= 0) {
          ctx.status = 404;
          ctx.body = { error: { code: 'ORDER_NOT_FOUND', message: 'order not found' } };
          return;
        }
        ctx.body = { item: await service.startOrder(orderId, await actorCtx(ctx)) };
      } catch (error) {
        if (!fail(ctx, error)) throw error;
      }
    },

    async complete(ctx: AdminCtx) {
      try {
        const service = strapi.plugin('ordering').service('kitchen') as ReturnType<typeof kitchenFactory>;
        const orderId = Number(ctx.params.id);
        if (!Number.isInteger(orderId) || orderId <= 0) {
          ctx.status = 404;
          ctx.body = { error: { code: 'ORDER_NOT_FOUND', message: 'order not found' } };
          return;
        }
        ctx.body = { item: await service.completeOrder(orderId, await actorCtx(ctx)) };
      } catch (error) {
        if (!fail(ctx, error)) throw error;
      }
    },
  };
};
