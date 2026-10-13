import type { Core } from '@strapi/strapi';

import type giftCardAdminFactory from '../services/gift-card-admin';
import { adminAction, positiveInt, text } from './http';

type GiftCardAdmin = ReturnType<typeof giftCardAdminFactory>;

/**
 * O9 "Thẻ quà tặng" admin surface (screens G1–G3), `gift-card.manage` — `gift-card.adjust`
 * additionally guards balance writes. The full code never sits in a URL: search-by-code and
 * every mutation read the body; the create response is the only place it appears.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () => strapi.plugin('ordering').service('gift-card-admin') as GiftCardAdmin;
  const id = (ctx: { params: Record<string, unknown> }) => positiveInt(ctx.params.id) ?? 0;
  const body = (ctx: { request: { body?: unknown } }) =>
    (ctx.request.body ?? {}) as Record<string, unknown>;

  return {
    list: adminAction(strapi, async (ctx, serviceCtx) =>
      service().list(
        {
          q: text(ctx.query.q),
          status: text(ctx.query.status),
          source: text(ctx.query.source),
          page: positiveInt(ctx.query.page),
        },
        serviceCtx,
      ),
    ),
    search: adminAction(strapi, async (ctx, serviceCtx) =>
      service().searchByCode(body(ctx).code, serviceCtx),
    ),
    get: adminAction(strapi, async (ctx, serviceCtx) => service().detail(id(ctx), serviceCtx)),
    create: adminAction(strapi, async (ctx, serviceCtx) => {
      const created = await service().create(body(ctx), serviceCtx);
      ctx.status = 201;
      return created;
    }),
    block: adminAction(strapi, async (ctx, serviceCtx) =>
      service().block(id(ctx), body(ctx), serviceCtx),
    ),
    unblock: adminAction(strapi, async (ctx, serviceCtx) =>
      service().unblock(id(ctx), body(ctx), serviceCtx),
    ),
    extend: adminAction(strapi, async (ctx, serviceCtx) =>
      service().extend(id(ctx), body(ctx), serviceCtx),
    ),
    adjust: adminAction(strapi, async (ctx, serviceCtx) =>
      service().adjust(id(ctx), body(ctx), serviceCtx),
    ),
    resend: adminAction(strapi, async (ctx, serviceCtx) => service().resend(id(ctx), serviceCtx)),

    // Physical preprinted batches — `/import` precedes `/:id` in the routes table.
    listBatches: adminAction(strapi, async (ctx) =>
      service().listBatches({ page: positiveInt(ctx.query.page) }),
    ),
    getBatch: adminAction(strapi, async (ctx) =>
      service().batchDetail(id(ctx), { page: positiveInt(ctx.query.page) }),
    ),
    createBatch: adminAction(strapi, async (ctx, serviceCtx) => {
      const created = await service().createBatch(body(ctx), serviceCtx);
      ctx.status = 201;
      return created;
    }),
    importBatch: adminAction(strapi, async (ctx, serviceCtx) =>
      service().importBatch(body(ctx), serviceCtx),
    ),
    exportBatch: adminAction(strapi, async (ctx, serviceCtx) => {
      const { csv, fileName } = await service().exportBatch(id(ctx), serviceCtx);
      ctx.set('Content-Type', 'text/csv; charset=utf-8');
      ctx.set('Content-Disposition', `attachment; filename="${fileName}"`);
      ctx.body = csv;
      return undefined;
    }),
  };
};
