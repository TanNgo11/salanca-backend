import type { Core } from '@strapi/strapi';

import { isOrderingError } from '../domain/errors';
import type catalogAvailabilityFactory from '../services/catalog-availability';

interface AdminCtx {
  query: Record<string, unknown>;
  request: { body?: unknown };
  state: { user?: { id?: number; roles?: { code?: string }[] } };
  status: number;
  body: unknown;
}

type CatalogAvailabilityService = ReturnType<typeof catalogAvailabilityFactory>;

const fail = (ctx: AdminCtx, error: unknown): void => {
  if (isOrderingError(error)) {
    ctx.status = error.status;
    ctx.body = { error: { code: error.code, message: error.message, details: error.details } };
    return;
  }
  throw error;
};

/**
 * "Tạm hết món" admin API (plan step 8). Routes are guarded by the plugin policy
 * `has-catalog-access` (catalog.manage OR catalog.toggle-availability); the service itself
 * enforces the staff member's branch scope on every call.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = (): CatalogAvailabilityService =>
    strapi.plugin('ordering').service('catalog-availability') as CatalogAvailabilityService;

  const ctxOf = async (ctx: AdminCtx) => service().contextFor(ctx.state.user ?? {});

  return {
    /** GET /availability/locations — scoped branch selector options. */
    async locations(ctx: AdminCtx) {
      try {
        ctx.body = await service().listLocations(await ctxOf(ctx));
      } catch (error) {
        fail(ctx, error);
      }
    },

    /** GET /availability?locationRef= — flat entity list + current state. */
    async list(ctx: AdminCtx) {
      try {
        const locationRef = typeof ctx.query.locationRef === 'string' ? ctx.query.locationRef : '';
        ctx.body = await service().list(locationRef, await ctxOf(ctx));
      } catch (error) {
        fail(ctx, error);
      }
    },

    /** POST /availability/toggle — { entityType, entityDocumentId, locationRef, selling, untilKind?, until? } */
    async toggle(ctx: AdminCtx) {
      try {
        const body = (ctx.request.body ?? {}) as Parameters<CatalogAvailabilityService['toggle']>[0];
        ctx.body = await service().toggle(body, await ctxOf(ctx));
      } catch (error) {
        fail(ctx, error);
      }
    },
  };
};
