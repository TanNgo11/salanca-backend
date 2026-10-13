import type { Core } from '@strapi/strapi';

import type jobLockFactory from '../services/job-lock';

type DataRequestResult = { ran: boolean; done: number; waiting: number; failed: number };

type DataRightsService = {
  processWaiting: (now: Date) => Promise<{ done: number; waiting: number; failed: number }>;
};

/**
 * `data-request-waiting` (O11 step 6): erasure requests that had open orders sit in `waiting`;
 * every 30 minutes the job re-runs them — an order that closed in the meantime unblocks the
 * anonymization + profile delete. `process` is idempotent, so a row may be retried any number
 * of times; failures are logged and left for the next run.
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
      if (result.done > 0 || result.failed > 0) {
        strapi.log.info(
          `[ordering] data-request-waiting done=${result.done} waiting=${result.waiting} failed=${result.failed}`,
        );
      }
      return result;
    },
  );
  return outcome.ran
    ? { ran: true, ...(outcome.result as Omit<DataRequestResult, 'ran'>) }
    : { ran: false, done: 0, waiting: 0, failed: 0 };
};
