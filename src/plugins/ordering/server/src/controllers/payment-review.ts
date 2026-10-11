import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import type paymentReviewFactory from '../services/payment-review';
import { adminAction, positiveInt, text, type HttpCtx } from './http';

type ReviewService = ReturnType<typeof paymentReviewFactory>;

const bodyOf = (ctx: HttpCtx): Record<string, unknown> =>
  ctx.request.body && typeof ctx.request.body === 'object' ? (ctx.request.body as Record<string, unknown>) : {};

const idOf = (ctx: HttpCtx): number => {
  const id = positiveInt(ctx.params.id);
  if (!id) {
    throw new OrderingError('VALIDATION_ERROR', 'id is required', { details: { field: 'id' } });
  }
  return id;
};

/**
 * "Duyệt chuyển khoản" (screens P2–P3). Routes require `payment.review`. Branch scope, including
 * money that cannot be tied to a branch, is enforced in the service.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const review = () => strapi.plugin('ordering').service('payment-review') as ReviewService;

  return {
    list: adminAction(strapi, async (ctx, serviceCtx) =>
      review().list(
        {
          status: text(ctx.query.status),
          reason: text(ctx.query.reason),
          branch: text(ctx.query.branch),
          from: text(ctx.query.from),
          to: text(ctx.query.to),
          q: text(ctx.query.q),
          page: positiveInt(ctx.query.page),
          pageSize: positiveInt(ctx.query.pageSize),
        },
        serviceCtx,
      ),
    ),
    searchOrders: adminAction(strapi, async (ctx, serviceCtx) =>
      review().searchOrders(text(ctx.query.q) ?? '', serviceCtx),
    ),
    assign: adminAction(strapi, async (ctx, serviceCtx) => {
      const body = bodyOf(ctx);
      return review().assign(idOf(ctx), { orderId: positiveInt(body.orderId), reason: body.reason }, serviceCtx);
    }),
    refundDue: adminAction(strapi, async (ctx, serviceCtx) => {
      const body = bodyOf(ctx);
      const amount = typeof body.amount === 'number' ? body.amount : undefined;
      return review().refundDue(idOf(ctx), { amount, reason: body.reason }, serviceCtx);
    }),
    reopen: adminAction(strapi, async (ctx, serviceCtx) => {
      const body = bodyOf(ctx);
      return review().reopen(idOf(ctx), { orderId: positiveInt(body.orderId), reason: body.reason }, serviceCtx);
    }),
    ignore: adminAction(strapi, async (ctx, serviceCtx) => {
      const body = bodyOf(ctx);
      return review().ignore(idOf(ctx), { reason: body.reason }, serviceCtx);
    }),
  };
};
