import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import type alertFactory from '../services/alert';
import type alertRulesFactory from '../services/alert-rules';
import type { ServiceContext } from '../services/context';
import type jobLockFactory from '../services/job-lock';
import type outboxFactory from '../services/outbox';
import type { OrderingRegistry } from '../services/registry';

const MINUTE_MS = 60_000;

type JobLockRow = {
  jobName: string;
  lastSuccessAt: string | Date | null;
  createdAt: string | Date | null;
};

/**
 * `ops-check` (contracts §12): the platform-level alert producer. `outbox-stuck` fires when the
 * oldest undelivered event is older than the rule's threshold minutes OR any event exhausted its
 * retries; `job-heartbeat-missed` fires when a scheduled job's last success is silent for more
 * than `threshold × heartbeatMinutes[job]`. Only jobs that already have a lock row are checked —
 * a job that never ran on this environment is not "silent".
 */
export const runOpsCheck = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<{ ran: boolean; opened: number; resolved: number }> => {
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const alerts = plugin.service('alert') as ReturnType<typeof alertFactory>;
  const alertRules = plugin.service('alert-rules') as ReturnType<typeof alertRulesFactory>;
  const outbox = plugin.service('outbox') as ReturnType<typeof outboxFactory>;
  const registry = plugin.service('registry') as OrderingRegistry;
  const config = strapi.config.get('plugin::ordering') as OrderingConfig;
  const now = options.now ?? new Date();
  const ctx: ServiceContext = { actor: { kind: 'system', actorRef: 'job:ops-check' }, now };

  const outcome = await jobLock.withLock(
    { jobName: 'ops-check', owner: options.owner, now },
    async () => {
      let opened = 0;
      let resolved = 0;
      const rules = await alertRules.get();

      const outboxRule = rules['outbox-stuck'];
      const stats = await outbox.pendingStats();
      const ageMinutes = stats.oldestAvailableAt
        ? (now.getTime() - new Date(stats.oldestAvailableAt).getTime()) / MINUTE_MS
        : 0;
      const stuck =
        outboxRule.enabled && (ageMinutes > outboxRule.threshold || stats.failed > 0);
      if (stuck) {
        const severity =
          outboxRule.criticalThreshold !== undefined && ageMinutes > outboxRule.criticalThreshold
            ? 'critical'
            : 'warning';
        const result = await alerts.open(
          {
            alertCode: 'outbox-stuck',
            dedupeKey: 'outbox-stuck',
            severity,
            aggregateRef: 'outbox',
          },
          ctx,
        );
        if (result.opened) opened += 1;
      } else if (await alerts.resolve('outbox-stuck', ctx)) {
        resolved += 1;
      }

      const heartbeatRule = rules['job-heartbeat-missed'];
      const locks = strapi.db.query('plugin::ordering.order-job-lock');
      for (const [jobName, minutes] of Object.entries(config.jobs.heartbeatMinutes)) {
        // SePay is optional — its reconciliation row simply never exists when unconfigured.
        if (jobName === 'sepay-reconciliation' && !registry.hasPaymentProvider('sepay')) continue;
        const row = (await locks.findOne({
          where: { jobName, shardKey: 'default' },
        })) as JobLockRow | null;
        if (!row) continue;
        const dedupeKey = `job-heartbeat-missed:${jobName}`;
        const bases = [row.lastSuccessAt, row.createdAt]
          .filter((value): value is string | Date => value !== null && value !== undefined)
          .map((value) => new Date(value).getTime());
        const silentMinutes =
          bases.length === 0 ? Number.POSITIVE_INFINITY : (now.getTime() - Math.max(...bases)) / MINUTE_MS;
        if (heartbeatRule.enabled && silentMinutes > heartbeatRule.threshold * minutes) {
          const severity =
            heartbeatRule.criticalThreshold !== undefined &&
            silentMinutes > heartbeatRule.criticalThreshold * minutes
              ? 'critical'
              : 'warning';
          const result = await alerts.open(
            {
              alertCode: 'job-heartbeat-missed',
              dedupeKey,
              severity,
              aggregateRef: `job:${jobName}`,
            },
            ctx,
          );
          if (result.opened) opened += 1;
        } else if (await alerts.resolve(dedupeKey, ctx)) {
          resolved += 1;
        }
      }

      return { opened, resolved };
    },
  );
  return outcome.ran ? { ran: true, ...outcome.result } : { ran: false, opened: 0, resolved: 0 };
};
