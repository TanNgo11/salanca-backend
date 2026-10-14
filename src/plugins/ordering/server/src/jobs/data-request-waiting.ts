import type { Core } from '@strapi/strapi';

import type alertFactory from '../services/alert';
import type { ServiceContext } from '../services/context';
import type jobLockFactory from '../services/job-lock';

type DataRequestResult = {
  ran: boolean;
  done: number;
  waiting: number;
  failed: number;
  /** Requests past `dataRights.deadlineHours` that hold an alert after this run. */
  overdue: number;
  /** Alerts closed because their request was handled since the last run. */
  resolved: number;
};

type DataRightsService = {
  processWaiting: (now: Date) => Promise<{ done: number; waiting: number; failed: number }>;
};

/**
 * `data-request-waiting` (O11 step 6): erasure requests that had open orders sit in `waiting`;
 * every 30 minutes the job re-runs them — an order that closed in the meantime unblocks the
 * anonymization + profile delete. `process` is idempotent, so a row may be retried any number
 * of times; failures are logged and left for the next run.
 *
 * After the retry it also keeps one `data-request-overdue` alert per request (export or erase)
 * still `received`/`waiting` past `dataRights.deadlineHours`, and resolves the alert of every
 * request that was done or rejected since — the same open/auto-close lifecycle as
 * `table-session-open`.
 */
export const runDataRequestWaiting = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<DataRequestResult> => {
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const now = options.now ?? new Date();
  const outcome = await jobLock.withLock(
    { jobName: 'data-request-waiting', owner: options.owner, now },
    async () => {
      const service = plugin.service('data-rights') as unknown as DataRightsService;
      const result = await service.processWaiting(now);
      const sweep = await syncOverdueAlerts(strapi, now);
      if (result.done > 0 || result.failed > 0) {
        strapi.log.info(
          `[ordering] data-request-waiting done=${result.done} waiting=${result.waiting} failed=${result.failed}`,
        );
      }
      return { ...result, ...sweep };
    },
  );
  return outcome.ran
    ? { ran: true, ...(outcome.result as Omit<DataRequestResult, 'ran'>) }
    : { ran: false, done: 0, waiting: 0, failed: 0, overdue: 0, resolved: 0 };
};

const OPEN_STATUSES = ['received', 'waiting'];

/** Opens an alert per overdue request, resolves the ones whose request is no longer open/overdue. */
const syncOverdueAlerts = async (
  strapi: Core.Strapi,
  now: Date,
): Promise<{ overdue: number; resolved: number }> => {
  const plugin = strapi.plugin('ordering');
  const alerts = plugin.service('alert') as ReturnType<typeof alertFactory>;
  const ctx: ServiceContext = { actor: { kind: 'system', actorRef: 'job:data-request-waiting' }, now };
  const deadlineHours = (strapi.config.get('plugin::ordering') as { dataRights: { deadlineHours: number } })
    .dataRights.deadlineHours;
  const cutoff = new Date(now.getTime() - deadlineHours * 3_600_000);

  const late = (await strapi.db.query('plugin::ordering.data-request').findMany({
    where: { status: { $in: OPEN_STATUSES }, requestedAt: { $lt: cutoff } },
    select: ['documentId'],
    orderBy: { requestedAt: 'asc' },
    limit: 500,
  })) as Array<{ documentId: string }>;

  const stillOverdue = new Set<string>();
  for (const row of late) {
    const key = `data-request-overdue:${row.documentId}`;
    stillOverdue.add(key);
    await alerts.open(
      {
        alertCode: 'data-request-overdue',
        dedupeKey: key,
        severity: 'warning',
        aggregateRef: `data-request:${row.documentId}`,
      },
      ctx,
    );
  }
  const flagged = (await strapi.db.query('plugin::ordering.ops-alert').findMany({
    where: { alertCode: 'data-request-overdue', status: { $in: ['open', 'acknowledged'] } },
    select: ['dedupeKey'],
  })) as Array<{ dedupeKey: string }>;
  let resolved = 0;
  for (const row of flagged) {
    if (!stillOverdue.has(row.dedupeKey) && (await alerts.resolve(row.dedupeKey, ctx))) resolved += 1;
  }
  return { overdue: stillOverdue.size, resolved };
};
