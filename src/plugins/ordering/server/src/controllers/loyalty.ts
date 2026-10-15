import type { Core } from '@strapi/strapi';

import type changeLogFactory from '../services/change-log';
import type loyaltyLifecycleFactory from '../services/loyalty-lifecycle';
import type loyaltySettingsFactory from '../services/loyalty-settings';
import type loyaltyTierFactory from '../services/loyalty-tier';
import { adminAction, positiveInt } from './http';

type Settings = ReturnType<typeof loyaltySettingsFactory>;
type Tiers = ReturnType<typeof loyaltyTierFactory>;
type LifecycleService = ReturnType<typeof loyaltyLifecycleFactory>;

/** O16 loyalty program admin surface (screens Y1–Y2): `loyalty.manage`. */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const settings = () => strapi.plugin('ordering').service('loyalty-settings') as Settings;
  const tiers = () => strapi.plugin('ordering').service('loyalty-tier') as Tiers;
  const lifecycle = () => strapi.plugin('ordering').service('loyalty-lifecycle') as LifecycleService;
  const changeLog = () => strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;
  const id = (ctx: { params: Record<string, unknown> }) => positiveInt(ctx.params.id) ?? 0;

  return {
    getSettings: adminAction(strapi, async () => ({ settings: await settings().get() })),
    putSettings: adminAction(strapi, async (ctx, serviceCtx) => ({
      settings: await settings().put(ctx.request.body, serviceCtx),
    })),
    listTiers: adminAction(strapi, async () => tiers().list()),
    getTier: adminAction(strapi, async (ctx) => tiers().get(id(ctx))),
    createTier: adminAction(strapi, async (ctx, serviceCtx) => {
      const created = await tiers().create(ctx.request.body, serviceCtx);
      ctx.status = 201;
      return created;
    }),
    /** POST /loyalty/tiers/recalculate — imports 12-month history into tiers (safe to repeat). */
    recalculate: adminAction(strapi, async (_ctx, serviceCtx) => {
      const result = await lifecycle().recalculateHistory(new Date());
      await changeLog().record(
        {
          action: 'loyalty.recalculate',
          entityType: 'loyalty-settings',
          entityId: 'loyalty',
          after: { orders: result.orders, customers: result.customers },
        },
        serviceCtx,
      );
      return result;
    }),
    updateTier: adminAction(strapi, async (ctx, serviceCtx) => tiers().update(id(ctx), ctx.request.body, serviceCtx)),
  };
};
