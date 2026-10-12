import type { Core } from '@strapi/strapi';

import type jobLockFactory from '../services/job-lock';
import type outboxFactory from '../services/outbox';

/**
 * Outbox dispatcher entry point. Deliberately runs WITHOUT a job lock: `claimBatch` uses
 * `FOR UPDATE SKIP LOCKED` + leases, so every running instance can dispatch safely — a job
 * lock on shard 'default' would needlessly serialize delivery to one process. A lock-free
 * `heartbeat` row still gives `job-heartbeat-missed` and the ops screen a pulse.
 */
export const runOutboxDispatcher = async (
  strapi: Core.Strapi,
  options: { owner: string },
): Promise<{ claimed: number; delivered: number; retried: number; failed: number }> => {
  const plugin = strapi.plugin('ordering');
  const outbox = plugin.service('outbox') as ReturnType<typeof outboxFactory>;
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const startedAt = new Date();
  try {
    const result = await outbox.dispatch({ owner: options.owner });
    await jobLock.heartbeat({ jobName: 'outbox', startedAt });
    return result;
  } catch (error) {
    await jobLock.heartbeat({ jobName: 'outbox', startedAt, error });
    throw error;
  }
};
