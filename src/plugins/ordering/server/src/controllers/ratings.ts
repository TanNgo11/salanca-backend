import type { Core } from '@strapi/strapi';

import type ratingFactory from '../services/rating';
import { adminAction, positiveInt, text } from './http';

type Ratings = ReturnType<typeof ratingFactory>;

/** O8 "Đánh giá" (screens R1–R2). Reading needs `order.read`; hide/note need `rating.manage`. */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () => strapi.plugin('ordering').service('rating') as Ratings;
  const body = (ctx: { request: { body?: unknown } }) => (ctx.request.body ?? {}) as Record<string, unknown>;

  return {
    list: adminAction(strapi, async (ctx, serviceCtx) =>
      service().listForStaff(
        {
          branch: text(ctx.query.branch),
          stars: text(ctx.query.stars),
          from: text(ctx.query.from),
          to: text(ctx.query.to),
          hasComment: text(ctx.query.hasComment),
          status: text(ctx.query.status),
          page: positiveInt(ctx.query.page),
        },
        serviceCtx,
      ),
    ),
    detail: adminAction(strapi, async (ctx, serviceCtx) =>
      service().detail(positiveInt(ctx.params.id) ?? 0, serviceCtx),
    ),
    hide: adminAction(strapi, async (ctx, serviceCtx) =>
      service().setHidden(positiveInt(ctx.params.id) ?? 0, body(ctx).hidden !== false, serviceCtx),
    ),
    note: adminAction(strapi, async (ctx, serviceCtx) =>
      service().setNote(positiveInt(ctx.params.id) ?? 0, body(ctx).note ?? null, serviceCtx),
    ),
  };
};
