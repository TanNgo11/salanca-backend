import type { Core } from '@strapi/strapi';

import { businessDate as businessDateOf } from '../domain/business-date';
import type alertFactory from '../services/alert';
import type branchFactory from '../services/branch';
import type { ServiceContext } from '../services/context';
import type jobLockFactory from '../services/job-lock';

/**
 * O12 `table-session-autoclose` (plan step 7): a session still `open` when the branch's
 * business day has rolled over is flagged `table-session-open` — the night crew sees it on
 * the alerts board and the N7 card turns red. The job never collects money and never closes
 * the session itself; closing stays a deliberate staff act. Once the session closes the
 * alert resolves, exactly like the sla-check lifecycle. Serialized by the job lock.
 */
export const runTableSessionAutoclose = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<{ ran: boolean; alerted: number; resolved: number }> => {
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const alerts = plugin.service('alert') as ReturnType<typeof alertFactory>;
  const branches = plugin.service('branch') as ReturnType<typeof branchFactory>;
  const now = options.now ?? new Date();
  const ctx: ServiceContext = {
    actor: { kind: 'system', actorRef: 'job:table-session-autoclose' },
    now,
  };

  const outcome = await jobLock.withLock(
    { jobName: 'table-session-autoclose', owner: options.owner, now },
    async () => {
      const open = (await strapi.db.query('plugin::ordering.table-session').findMany({
        where: { status: 'open' },
        limit: 500,
      })) as Array<{
        id: number;
        locationRef: string;
        businessDate: string;
        table?: number | { id: number } | null;
      }>;
      // One business-date resolution per branch (timezone + per-kind cutoff).
      const todayOf = new Map<string, string>();
      const todayFor = async (locationRef: string): Promise<string> => {
        let today = todayOf.get(locationRef);
        if (today === undefined) {
          const branch = await branches.findByCode(locationRef);
          const cutoff =
            branch != null
              ? branches.receiveSettings(branch, 'dine-in').schedule.businessDayPolicy
                  .cutoffLocalTime
              : '04:00';
          today = businessDateOf(now, branch?.timezone ?? 'Asia/Ho_Chi_Minh', cutoff);
          todayOf.set(locationRef, today);
        }
        return today;
      };

      let alerted = 0;
      const stillStale = new Set<string>();
      for (const session of open) {
        const today = await todayFor(session.locationRef);
        if (session.businessDate >= today) continue;
        const key = `table-session-open:${session.id}`;
        stillStale.add(key);
        const result = await alerts.open(
          {
            alertCode: 'table-session-open',
            dedupeKey: key,
            severity: 'warning',
            aggregateRef: `table-session:${session.id}`,
            locationRef: session.locationRef,
          },
          ctx,
        );
        if (result.opened) alerted += 1;
      }
      // Sessions that closed since the last run resolve their alert automatically.
      const flagged = (await strapi.db.query('plugin::ordering.ops-alert').findMany({
        where: { alertCode: 'table-session-open', status: { $in: ['open', 'acknowledged'] } },
        select: ['dedupeKey'],
      })) as Array<{ dedupeKey: string }>;
      let resolved = 0;
      for (const row of flagged) {
        if (!stillStale.has(row.dedupeKey) && (await alerts.resolve(row.dedupeKey, ctx))) {
          resolved += 1;
        }
      }
      return { alerted, resolved };
    },
  );
  return outcome.ran
    ? { ran: true, ...outcome.result }
    : { ran: false, alerted: 0, resolved: 0 };
};
