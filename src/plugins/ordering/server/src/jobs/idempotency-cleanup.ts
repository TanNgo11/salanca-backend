import type { Core } from '@strapi/strapi';

import type idempotencyFactory from '../services/idempotency';
import type jobLockFactory from '../services/job-lock';

/** Deletes idempotency rows past their TTL; serialized across instances by the job lock. */
export const runIdempotencyCleanup = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<{ ran: boolean; deleted: number }> => {
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const idempotency = plugin.service('idempotency') as ReturnType<typeof idempotencyFactory>;
  const now = options.now ?? new Date();
  const outcome = await jobLock.withLock(
    { jobName: 'idempotency-cleanup', owner: options.owner, now },
    () => idempotency.cleanupExpired(now),
  );
  return outcome.ran ? { ran: true, deleted: outcome.result } : { ran: false, deleted: 0 };
};
