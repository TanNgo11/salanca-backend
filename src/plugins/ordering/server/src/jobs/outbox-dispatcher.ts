import type { Core } from '@strapi/strapi';

import type outboxFactory from '../services/outbox';

/**
 * Outbox dispatcher entry point. Deliberately runs WITHOUT a job lock: `claimBatch` uses
 * `FOR UPDATE SKIP LOCKED` + leases, so every running instance can dispatch safely — a job
 * lock on shard 'default' would needlessly serialize delivery to one process.
 */
export const runOutboxDispatcher = async (
  strapi: Core.Strapi,
  options: { owner: string },
): Promise<{ claimed: number; delivered: number; retried: number; failed: number }> => {
  const outbox = strapi
    .plugin('ordering')
    .service('outbox') as ReturnType<typeof outboxFactory>;
  return outbox.dispatch({ owner: options.owner });
};
