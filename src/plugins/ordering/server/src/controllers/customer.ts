import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import { LIMITS } from '../domain/storefront/parse';
import type cartFactory from '../services/cart';
import type customerFactory from '../services/customer';
import type dataRightsFactory from '../services/data-rights';
import type loyaltyLifecycleFactory from '../services/loyalty-lifecycle';
import type { ServiceContext } from '../services/context';
import { withCartPromotionGuard } from './cart-promotion-guard';
import { requireCustomer } from './customer-auth';
import type { HttpCtx } from './http';
import { positiveInt, sendError } from './http';
import { rateLimited } from './storefront-guard';

type CustomerService = ReturnType<typeof customerFactory>;
type CartService = ReturnType<typeof cartFactory>;
type DataRightsService = ReturnType<typeof dataRightsFactory>;
type LifecycleService = ReturnType<typeof loyaltyLifecycleFactory>;

/**
 * Public `/me*` (O11 step 3): every action needs a live `X-Customer-Token` — an absent or dead
 * token answers `CUSTOMER_AUTH_REQUIRED` (401) before anything runs. Reads and writes are
 * scoped to that token's customer; a foreign documentId/order code is a 404, never a 403.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const customers = () =>
    strapi.plugin('ordering').service('customer') as CustomerService;
  const carts = () => strapi.plugin('ordering').service('cart') as CartService;
  const dataRights = () =>
    strapi.plugin('ordering').service('data-rights') as DataRightsService;

  const customerCtx = (): ServiceContext => ({
    actor: { kind: 'customer' },
    requestId: randomUUID(),
  });

  const action =
    (run: (ctx: HttpCtx, serviceCtx: ServiceContext, customerId: number) => Promise<unknown>) =>
    async (ctx: HttpCtx) => {
      const serviceCtx = customerCtx();
      if (rateLimited(strapi, ctx, 'read')) return;
      try {
        ctx.set('Cache-Control', 'no-store');
        const length = Number(ctx.get('content-length') || 0);
        if (length > LIMITS.bodyBytes) {
          ctx.status = 413;
          ctx.body = { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } };
          return;
        }
        const { customer } = await requireCustomer(strapi, ctx, serviceCtx);
        const result = await run(ctx, serviceCtx, customer.id);
        if (result !== undefined) ctx.body = result;
      } catch (error) {
        sendError(ctx, error, serviceCtx.requestId);
      }
    };

  return {
    /** GET /me — own profile + stats. */
    me: action(async (_ctx, _serviceCtx, customerId) =>
      customers().profile(customerId),
    ),

    /** PUT /me { name?, email?, marketingConsent? } — email accepted only unchanged. */
    update: action(async (ctx, serviceCtx, customerId) =>
      customers().updateProfile(
        customerId,
        (ctx.request.body ?? {}) as { name?: unknown; email?: unknown; marketingConsent?: unknown },
        serviceCtx,
      ),
    ),

    /** GET /me/addresses — the address book (default first). */
    listAddresses: action(async (_ctx, _serviceCtx, customerId) => ({
      items: await customers().listAddresses(customerId),
    })),

    /** POST /me/addresses — max 10; the first or `isDefault` one becomes the default. */
    createAddress: action(async (ctx, _serviceCtx, customerId) => {
      const address = await customers().createAddress(
        customerId,
        (ctx.request.body ?? {}) as Parameters<CustomerService['createAddress']>[1],
      );
      ctx.status = 201;
      return { address };
    }),

    /** PUT /me/addresses/:id — full address body; foreign ids 404. */
    updateAddress: action(async (ctx, _serviceCtx, customerId) => ({
      address: await customers().updateAddress(
        customerId,
        ctx.params.id ?? '',
        (ctx.request.body ?? {}) as Parameters<CustomerService['updateAddress']>[2],
      ),
    })),

    /** DELETE /me/addresses/:id — 204; deleting the default promotes the oldest. */
    deleteAddress: action(async (ctx, _serviceCtx, customerId) => {
      await customers().deleteAddress(customerId, ctx.params.id ?? '');
      ctx.status = 204;
      return undefined;
    }),

    /** GET /me/orders?page=&pageSize= — own orders, reduced status view. */
    myOrders: action(async (ctx, _serviceCtx, customerId) => {
      const page = positiveInt(ctx.query.page) ?? 1;
      const pageSize = Math.min(positiveInt(ctx.query.pageSize) ?? 10, 50);
      return customers().myOrders(customerId, page, pageSize);
    }),

    /** GET /me/orders/:code — own order by code; foreign/missing → 404. */
    myOrder: action(async (ctx, _serviceCtx, customerId) => ({
      order: await customers().orderByCode(customerId, ctx.params.code ?? ''),
    })),

    /** POST /me/orders/:code/reorder — still-sellable lines land in the current cart. */
    reorder: action(async (ctx, serviceCtx, customerId) => {
      const { row, unavailable } = await carts().fromOrder(
        customerId,
        ctx.params.code ?? '',
        serviceCtx,
      );
      return withCartPromotionGuard(strapi, ctx, row.promotionCode, 'stored', async () => {
        const view = await carts().view(row, serviceCtx);
        return { ...view, unavailable };
      });
    }),

    /** GET /me/loyalty — balance, tier, next tier and points expiring within 30 days. */
    loyalty: action(async (_ctx, _serviceCtx, customerId) => ({
      loyalty: await (strapi.plugin('ordering').service('loyalty-lifecycle') as LifecycleService).summaryFor(customerId),
    })),

    /** GET /me/loyalty/history?page= — the customer's ledger without staff notes. */
    loyaltyHistory: action(async (ctx, _serviceCtx, customerId) =>
      (strapi.plugin('ordering').service('loyalty-lifecycle') as LifecycleService).historyFor(
        customerId,
        positiveInt(ctx.query.page) ?? 1,
      ),
    ),

    /** GET /me/data-export — the customer's own data as JSON (Decree 13 access right). */
    dataExport: action(async (_ctx, _serviceCtx, customerId) =>
      dataRights().exportForSelf(customerId),
    ),

    /**
     * POST /me/erase {confirm:true} — records the erasure request, signs out every session
     * (this token included), and erases at once unless an order is still open (→ waiting).
     */
    erase: action(async (ctx, serviceCtx, customerId) => {
      const body = (ctx.request.body ?? {}) as { confirm?: unknown };
      if (body.confirm !== true) {
        throw new OrderingError('VALIDATION_ERROR', 'confirm:true is required to erase data', {
          details: { field: 'confirm' },
        });
      }
      const request = await dataRights().requestSelfErase(customerId, serviceCtx);
      ctx.status = 202;
      return { request };
    }),
  };
};
