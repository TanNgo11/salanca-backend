import type { Core } from '@strapi/strapi';

import type cashClosingFactory from '../services/cash-closing';
import { adminAction } from './http';

type CashClosing = ReturnType<typeof cashClosingFactory>;

/**
 * Reports support endpoints (O6 steps 3+4). `GET /reports/branches` feeds the branch/day
 * pickers of the reports screens with the caller's scoped branches.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () => strapi.plugin('ordering').service('cash-closing') as CashClosing;

  return {
    branches: adminAction(strapi, async (_ctx, serviceCtx) =>
      service().reportBranches(serviceCtx),
    ),
  };
};
