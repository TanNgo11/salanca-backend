import type { Core } from '@strapi/strapi';

import type promotionAdminFactory from '../services/promotion-admin';
import { adminAction, positiveInt, text } from './http';

type PromotionAdmin = ReturnType<typeof promotionAdminFactory>;

/** O8 "Khuyến mãi" (screens K1–K4), `promotion.manage`; the code CSV also needs `export`. */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () => strapi.plugin('ordering').service('promotion-admin') as PromotionAdmin;
  const id = (ctx: { params: Record<string, unknown> }) => positiveInt(ctx.params.id) ?? 0;
  const body = (ctx: { request: { body?: unknown } }) => (ctx.request.body ?? {}) as Record<string, unknown>;

  return {
    list: adminAction(strapi, async (ctx, serviceCtx) =>
      service().list(
        {
          status: text(ctx.query.status),
          kind: text(ctx.query.kind),
          q: text(ctx.query.q),
          page: positiveInt(ctx.query.page),
        },
        serviceCtx,
      ),
    ),
    targets: adminAction(strapi, async (ctx) => service().targets(text(ctx.query.locale) ?? 'vi')),
    get: adminAction(strapi, async (ctx, serviceCtx) => service().get(id(ctx), serviceCtx)),
    create: adminAction(strapi, async (ctx, serviceCtx) => {
      const created = await service().create(ctx.request.body, serviceCtx);
      ctx.status = 201;
      return created;
    }),
    update: adminAction(strapi, async (ctx, serviceCtx) => service().update(id(ctx), ctx.request.body, serviceCtx)),
    setActive: adminAction(strapi, async (ctx, serviceCtx) =>
      service().setActive(id(ctx), body(ctx).active, serviceCtx),
    ),
    codes: adminAction(strapi, async (ctx) =>
      service().listCodes(id(ctx), { q: text(ctx.query.q), page: positiveInt(ctx.query.page) }),
    ),
    addCodes: adminAction(strapi, async (ctx, serviceCtx) => service().addCodes(id(ctx), ctx.request.body, serviceCtx)),
    codeActive: adminAction(strapi, async (ctx, serviceCtx) =>
      service().setCodeActive(id(ctx), body(ctx).active, serviceCtx),
    ),
    exportCodes: adminAction(strapi, async (ctx, serviceCtx) => {
      const { csv, fileName } = await service().exportCodes(id(ctx), serviceCtx);
      ctx.set('Content-Type', 'text/csv; charset=utf-8');
      ctx.set('Content-Disposition', `attachment; filename="${fileName}"`);
      ctx.body = csv;
      return undefined;
    }),
    redemptions: adminAction(strapi, async (ctx) =>
      service().redemptions(id(ctx), { page: positiveInt(ctx.query.page) }),
    ),
  };
};
