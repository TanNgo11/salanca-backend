import type { Core } from '@strapi/strapi';

import type alertFactory from '../services/alert';
import type alertRulesFactory from '../services/alert-rules';
import type branchFactory from '../services/branch';
import type { ServiceContext } from '../services/context';
import type jobLockFactory from '../services/job-lock';

/**
 * `order-awaiting-acceptance` (spec O3): an order still waiting for the branch longer than the
 * branch's `slaMinutes` opens one alert per order; once it leaves awaiting-acceptance the alert
 * resolves. It turns critical once the wait passes the rule's `criticalThreshold` × the SLA.
 * Serialized across instances by the job lock.
 */
export const runSlaCheck = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<{ ran: boolean; opened: number; resolved: number }> => {
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const alerts = plugin.service('alert') as ReturnType<typeof alertFactory>;
  const branches = plugin.service('branch') as ReturnType<typeof branchFactory>;
  const alertRules = plugin.service('alert-rules') as ReturnType<typeof alertRulesFactory>;
  const rule = await alertRules.ruleOf('order-awaiting-acceptance');
  const now = options.now ?? new Date();
  const ctx: ServiceContext = { actor: { kind: 'system', actorRef: 'job:sla-check' }, now };

  const outcome = await jobLock.withLock({ jobName: 'sla-check', owner: options.owner, now }, async () => {
    let opened = 0;
    let resolved = 0;
    const waiting = (await strapi.db.query('plugin::ordering.fulfillment-group').findMany({
      where: { status: 'awaiting-acceptance' },
      populate: {
        order: { select: ['id', 'code', 'placedAt', 'locationRef', 'status', 'receiveMethod'] },
      },
      limit: 500,
    })) as Array<{
      order: {
        id: number;
        code: string;
        placedAt: string;
        locationRef: string;
        status: string;
        receiveMethod: { kind?: string } | null;
      } | null;
    }>;
    const sla = new Map<string, number>();
    const stillWaiting = new Set<string>();
    for (const group of waiting) {
      const order = group.order;
      if (!order || order.status !== 'open') continue;
      const slaKey = `${order.locationRef}:${order.receiveMethod?.kind ?? 'pickup'}`;
      let minutes = sla.get(slaKey);
      if (minutes === undefined) {
        const branch = await branches.findByCode(order.locationRef);
        minutes = branches.receiveSettings(
          branch ?? { fulfillment: null },
          order.receiveMethod?.kind ?? 'pickup',
        ).slaMinutes;
        sla.set(slaKey, minutes);
      }
      const key = `order-awaiting-acceptance:${order.id}`;
      stillWaiting.add(key);
      const waitedMs = now.getTime() - new Date(order.placedAt).getTime();
      if (waitedMs <= minutes * 60_000) continue;
      const result = await alerts.open(
        {
          alertCode: 'order-awaiting-acceptance',
          dedupeKey: key,
          // Critical once the wait passes `criticalThreshold` × the branch SLA.
          severity:
            rule.criticalThreshold !== undefined &&
            waitedMs > rule.criticalThreshold * minutes * 60_000
              ? 'critical'
              : 'warning',
          aggregateRef: `order:${order.id}`,
          locationRef: order.locationRef,
        },
        ctx,
      );
      if (result.opened) opened += 1;
    }
    const open = (await strapi.db.query('plugin::ordering.ops-alert').findMany({
      where: { alertCode: 'order-awaiting-acceptance', status: { $in: ['open', 'acknowledged'] } },
      select: ['dedupeKey'],
    })) as Array<{ dedupeKey: string }>;
    for (const row of open) {
      if (!stillWaiting.has(row.dedupeKey) && (await alerts.resolve(row.dedupeKey, ctx))) resolved += 1;
    }
    return { opened, resolved };
  });
  return outcome.ran ? { ran: true, ...outcome.result } : { ran: false, opened: 0, resolved: 0 };
};
