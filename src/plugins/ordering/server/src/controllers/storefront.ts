import type { Core } from '@strapi/strapi';

import type branchFactory from '../services/branch';
import type { HttpCtx } from './http';
import { sendError } from './http';
import { rateLimited } from './storefront-guard';

type BranchService = ReturnType<typeof branchFactory>;

/**
 * Public storefront API (contracts §11, §21; `auth: false`, so every action rate-limits and
 * returns only allowlisted fields). Order routes are added with plan step 5.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const branches = () => strapi.plugin('ordering').service('branch') as BranchService;

  return {
    /** GET /branches — active branches that sell online. */
    async branches(ctx: HttpCtx) {
      if (rateLimited(strapi, ctx, 'read')) return;
      try {
        ctx.set('Cache-Control', 'public, max-age=30');
        ctx.body = { items: await branches().listPublic() };
      } catch (error) {
        sendError(ctx, error);
      }
    },
  };
};
