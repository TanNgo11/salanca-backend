import type { Core } from '@strapi/strapi';

import type cashClosingFactory from '../services/cash-closing';
import type reportsFactory from '../services/reports';
import { adminAction, text } from './http';

type CashClosing = ReturnType<typeof cashClosingFactory>;
type Reports = ReturnType<typeof reportsFactory>;

/**
 * Reports endpoints (O6 steps 3+4). `GET /reports/branches` feeds the branch/day pickers
 * with the caller's scoped branches; `GET /reports/sales` is the V4 sales report. Both sit
 * behind `report.read`; the service enforces the caller's location scope.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const closings = () => strapi.plugin('ordering').service('cash-closing') as CashClosing;
  const reports = () => strapi.plugin('ordering').service('reports') as Reports;

  return {
    branches: adminAction(strapi, async (_ctx, serviceCtx) =>
      closings().reportBranches(serviceCtx),
    ),
    sales: adminAction(strapi, async (ctx, serviceCtx) =>
      reports().sales(
        {
          branch: text(ctx.query.branch) ?? undefined,
          from: text(ctx.query.from) ?? undefined,
          to: text(ctx.query.to) ?? undefined,
          groupBy: text(ctx.query.groupBy) ?? undefined,
        },
        serviceCtx,
      ),
    ),
  };
};
