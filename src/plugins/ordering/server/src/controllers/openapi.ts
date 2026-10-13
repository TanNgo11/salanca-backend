import type { Core } from '@strapi/strapi';

import type { HttpCtx } from './http';
import { sendError } from './http';
import { buildOpenApi } from '../openapi';

/**
 * GET /api/v1/ordering/openapi.json — the public storefront contract, cached for one hour.
 * The admin document never leaves the server: `pnpm run ordering:openapi` writes it to
 * docs/ordering-admin-openapi.json instead.
 */
export default (_ctx: { strapi: Core.Strapi }) => ({
  async document(ctx: HttpCtx) {
    try {
      ctx.set('Cache-Control', 'public, max-age=3600');
      ctx.body = buildOpenApi('public');
    } catch (error) {
      sendError(ctx, error);
    }
  },
});
