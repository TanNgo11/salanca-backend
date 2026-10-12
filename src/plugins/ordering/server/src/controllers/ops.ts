import type { Core } from '@strapi/strapi';

import type alertFactory from '../services/alert';
import type alertRulesFactory from '../services/alert-rules';
import { adminAction, positiveInt, text } from './http';

type AlertService = ReturnType<typeof alertFactory>;
type AlertRules = ReturnType<typeof alertRulesFactory>;

const body = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Ops surface (O6 step 1, screens V2): alert rules under `settings.manage`, the alert inbox and
 * acknowledgement under the `has-alert-access` policy — the service narrows rows to the rules
 * the staff's actions subscribe them to plus their location scope.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const rules = () => strapi.plugin('ordering').service('alert-rules') as AlertRules;
  const alerts = () => strapi.plugin('ordering').service('alert') as AlertService;

  return {
    getAlertRules: adminAction(strapi, async () => ({ rules: await rules().get() })),
    putAlertRules: adminAction(strapi, async (ctx, serviceCtx) => ({
      rules: await rules().put(body(ctx.request.body).rules, serviceCtx),
    })),
    listAlerts: adminAction(strapi, async (ctx, serviceCtx) =>
      alerts().listForStaff(
        {
          status: text(ctx.query.status),
          page: positiveInt(ctx.query.page),
          pageSize: positiveInt(ctx.query.pageSize),
        },
        serviceCtx,
      ),
    ),
    acknowledgeAlert: adminAction(strapi, async (ctx, serviceCtx) => ({
      alert: await alerts().acknowledgeForStaff(positiveInt(ctx.params.id) ?? 0, serviceCtx),
    })),
  };
};
