import type { Core } from '@strapi/strapi';

import { isOrderingError } from '../domain/errors';
import type printFactory from '../services/print';
import type scopeFactory from '../services/scope';

interface AdminCtx {
  query: Record<string, unknown>;
  params: Record<string, string | undefined>;
  state: { user?: { id?: number; roles?: { code?: string }[] } };
  status: number;
  body: unknown;
}

/**
 * Print payloads for the Admin print pages (O12 plan step 5, screens N1):
 * `GET /print/orders/:id?doc=kitchen|receipt` behind `order.read`. The service strips
 * contact/money by doc; the React page owns layout and `window.print()`.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async order(ctx: AdminCtx) {
    try {
      const service = strapi.plugin('ordering').service('print') as ReturnType<typeof printFactory>;
      const scope = strapi.plugin('ordering').service('scope') as ReturnType<typeof scopeFactory>;
      const actor = await scope.actorFromAdminUser(ctx.state.user ?? {});
      const orderId = Number(ctx.params.id);
      if (!Number.isInteger(orderId) || orderId <= 0) {
        ctx.status = 404;
        ctx.body = { error: { code: 'ORDER_NOT_FOUND', message: 'order not found' } };
        return;
      }
      const doc = typeof ctx.query.doc === 'string' ? ctx.query.doc : 'kitchen';
      ctx.body = { item: await service.forOrder(orderId, doc, { actor }) };
    } catch (error) {
      if (isOrderingError(error)) {
        ctx.status = error.status;
        ctx.body = { error: { code: error.code, message: error.message, details: error.details } };
        return;
      }
      throw error;
    }
  },
});
