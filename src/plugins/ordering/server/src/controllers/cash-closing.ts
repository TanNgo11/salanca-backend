import type { Core } from '@strapi/strapi';

import type cashClosingFactory from '../services/cash-closing';
import { adminAction, positiveInt, text } from './http';

type CashClosing = ReturnType<typeof cashClosingFactory>;

const body = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * End-of-day cash closing (O6 step 3, screens V3, contracts §19.3). All routes sit behind
 * `report.read`; the service additionally enforces the caller's location scope (out-of-scope
 * branches answer 404, never 403).
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () => strapi.plugin('ordering').service('cash-closing') as CashClosing;

  return {
    summary: adminAction(strapi, async (ctx, serviceCtx) =>
      service().summary(
        text(ctx.query.branch) ?? '',
        text(ctx.query.businessDate) ?? '',
        serviceCtx,
      ),
    ),
    close: adminAction(strapi, async (ctx, serviceCtx) => {
      const input = body(ctx.request.body);
      return service().close(
        {
          locationRef: String(input.branch ?? ''),
          businessDate: String(input.businessDate ?? ''),
          collectorRef: String(input.collectorRef ?? ''),
          countedAmount: Number(input.countedAmount),
          note: input.note as string | null | undefined,
        },
        serviceCtx,
      );
    }),
    adjust: adminAction(strapi, async (ctx, serviceCtx) => {
      const input = body(ctx.request.body);
      return service().adjust(
        positiveInt(ctx.params.id) ?? 0,
        {
          countedAmount: Number(input.countedAmount),
          note: input.note as string | null | undefined,
          reason: input.reason as string | null | undefined,
        },
        serviceCtx,
      );
    }),
  };
};
