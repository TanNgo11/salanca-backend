import type { Core } from '@strapi/strapi';

import type adminCustomersFactory from '../services/admin-customers';
import type dataRightsFactory from '../services/data-rights';
import { adminAction, positiveInt, text } from './http';

type DataRights = ReturnType<typeof dataRightsFactory>;
type AdminCustomers = ReturnType<typeof adminCustomersFactory>;

/**
 * Staff endpoints for customers and Decree 13 data requests (O11 steps 6–7): the export
 * payload is the same one the customer sees over `/me/data-export`, scoped to branches the
 * staff member can reach. Request processing is idempotent — the `data-request-waiting` job
 * covers requests the staff triggers here manually.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const dataRights = () =>
    strapi.plugin('ordering').service('data-rights') as unknown as DataRights;
  const adminCustomers = () =>
    strapi.plugin('ordering').service('admin-customers') as unknown as AdminCustomers;

  return {
    /** GET /customers?q=&status=&marketing=&page= — the C1 directory. */
    list: adminAction(strapi, async (ctx, serviceCtx) =>
      adminCustomers().list(
        {
          q: text(ctx.query.q),
          status: text(ctx.query.status),
          marketing: text(ctx.query.marketing),
          page: positiveInt(ctx.query.page),
          pageSize: positiveInt(ctx.query.pageSize),
        },
        serviceCtx,
      ),
    ),

    /** GET /customers/:id — the C2 profile (masked; reveal is a separate logged call). */
    detail: adminAction(strapi, async (ctx, serviceCtx) =>
      adminCustomers().detail(String(ctx.params.id ?? ''), serviceCtx),
    ),

    /** PUT /customers/:id {name?, staffNote?} — staff edit; masked before/after logged. */
    update: adminAction(strapi, async (ctx, serviceCtx) =>
      adminCustomers().update(
        String(ctx.params.id ?? ''),
        (ctx.request.body ?? {}) as { name?: unknown; staffNote?: unknown },
        serviceCtx,
      ),
    ),

    /** POST /customers/:id/reveal-phone — returns the full number once; logged. */
    revealPhone: adminAction(strapi, async (ctx, serviceCtx) =>
      adminCustomers().revealPhone(String(ctx.params.id ?? ''), serviceCtx),
    ),

    /** GET /customers/:id/export — JSON dump; logs `customer.export`. */
    exportCustomer: adminAction(strapi, async (ctx, serviceCtx) =>
      dataRights().exportForStaff(String(ctx.params.id ?? ''), serviceCtx),
    ),

    /** GET /data-requests?status=&page=&pageSize= — the processing queue. */
    listRequests: adminAction(strapi, async (ctx, serviceCtx) =>
      dataRights().listRequests(
        {
          status: text(ctx.query.status),
          page: positiveInt(ctx.query.page),
          pageSize: positiveInt(ctx.query.pageSize),
        },
        serviceCtx,
      ),
    ),

    /** POST /data-requests {phone, kind, note} — staff files a request for a customer. */
    createRequest: adminAction(strapi, async (ctx, serviceCtx) => {
      const request = await dataRights().createStaffRequest(
        (ctx.request.body ?? {}) as Parameters<DataRights['createStaffRequest']>[0],
        serviceCtx,
      );
      ctx.status = 201;
      return { request };
    }),

    /** POST /data-requests/:id/process — run erasure now (open orders → waiting). */
    processRequest: adminAction(strapi, async (ctx, serviceCtx) => ({
      request: await dataRights().processByStaff(
        String(ctx.params.id ?? ''),
        serviceCtx,
      ),
    })),

    /** POST /data-requests/:id/reject {reason} — refuse with a recorded reason. */
    rejectRequest: adminAction(strapi, async (ctx, serviceCtx) => ({
      request: await dataRights().rejectRequest(
        String(ctx.params.id ?? ''),
        (ctx.request.body ?? {}) as { reason?: unknown },
        serviceCtx,
      ),
    })),
  };
};
