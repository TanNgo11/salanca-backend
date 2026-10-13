import type { Core } from '@strapi/strapi';

import type priceListFactory from '../services/price-list';
import { adminAction, positiveInt, text } from './http';

type PriceLists = ReturnType<typeof priceListFactory>;

/** O14 price lists (screens L1–L2). `price.manage` only — not `promotion.manage`. */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () => strapi.plugin('ordering').service('price-list') as PriceLists;
  const id = (ctx: { params: Record<string, unknown> }) => positiveInt(ctx.params.id) ?? 0;

  return {
    list: adminAction(strapi, async () => service().list()),
    options: adminAction(strapi, async (ctx) => service().options(text(ctx.query.locale) ?? 'vi')),
    get: adminAction(strapi, async (ctx) => service().get(id(ctx))),
    create: adminAction(strapi, async (ctx, serviceCtx) => {
      const created = await service().create(ctx.request.body, serviceCtx);
      ctx.status = 201;
      return created;
    }),
    update: adminAction(strapi, async (ctx, serviceCtx) => service().update(id(ctx), ctx.request.body, serviceCtx)),
    setActive: adminAction(strapi, async (ctx, serviceCtx) => {
      const body = (ctx.request.body ?? {}) as { active?: unknown };
      return service().setActive(id(ctx), body.active, serviceCtx);
    }),
    preview: adminAction(strapi, async (ctx) => service().preview(ctx.request.body)),
  };
};
