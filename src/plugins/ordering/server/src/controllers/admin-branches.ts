import type { Core } from '@strapi/strapi';

import type branchFactory from '../services/branch';
import { adminAction } from './http';

type BranchService = ReturnType<typeof branchFactory>;

/**
 * "Chi nhánh" screen API (screens S7). Routes require `plugin::ordering.settings.manage`; the
 * service limits every call to the staff member's branch scope (out of scope = 404).
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () => strapi.plugin('ordering').service('branch') as BranchService;

  return {
    list: adminAction(strapi, async (_ctx, serviceCtx) => ({
      results: await service().listForAdmin(serviceCtx),
      paymentProviders: service().enabledPaymentProviders().known,
    })),
    get: adminAction(strapi, async (ctx, serviceCtx) => ({
      item: await service().getForAdmin(ctx.params.code ?? '', serviceCtx),
    })),
    create: adminAction(strapi, async (ctx, serviceCtx) => ({
      item: await service().createBranch(ctx.request.body ?? {}, serviceCtx),
    })),
    update: adminAction(strapi, async (ctx, serviceCtx) => ({
      item: await service().updateBranch(ctx.params.code ?? '', ctx.request.body ?? {}, serviceCtx),
    })),
  };
};
