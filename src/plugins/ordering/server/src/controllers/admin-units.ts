import type { Core } from '@strapi/strapi';

import type adminUnitsFactory from '../services/admin-units';
import type { HttpCtx } from './http';
import { sendError, text } from './http';
import { rateLimited } from './storefront-guard';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * `GET /ordering/admin-units` — read-only province/commune catalog for the address form.
 * "admin-units" is the administrative list, not the Admin API. Public responses are cached
 * for a day; an empty catalog is cached for a minute so a restart is noticed quickly.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const units = () => strapi.plugin('ordering').service('admin-units') as ReturnType<typeof adminUnitsFactory>;

  return {
    async list(ctx: HttpCtx) {
      if (rateLimited(strapi, ctx, 'read')) return;
      try {
        const loaded = units().load();
        const requested = Number.parseInt(String(ctx.query.limit ?? ''), 10);
        const provinceCode = text(ctx.query.province);
        const limit = clamp(
          Number.isFinite(requested) ? requested : provinceCode ? 2000 : 50,
          1,
          provinceCode ? 5000 : 200,
        );
        ctx.set('Cache-Control', loaded.available ? 'public, max-age=86400' : 'public, max-age=60');
        ctx.body = units().view({
          q: text(ctx.query.q)?.slice(0, 80),
          provinceCode,
          limit,
        });
      } catch (error) {
        sendError(ctx, error);
      }
    },
  };
};
