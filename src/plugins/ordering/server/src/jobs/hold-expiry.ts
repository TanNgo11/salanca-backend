import type { Core } from '@strapi/strapi';

import type { ServiceContext } from '../services/context';
import type holdFactory from '../services/hold';
import type jobLockFactory from '../services/job-lock';

/** Releases open holds whose `expiresAt` has passed; serialized across instances by the job lock. */
export const runHoldExpiry = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<{ ran: boolean; released: number }> => {
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const hold = plugin.service('hold') as ReturnType<typeof holdFactory>;
  const now = options.now ?? new Date();
  const ctx: ServiceContext = { actor: { kind: 'system', actorRef: 'job:hold-expiry' }, now };
  const outcome = await jobLock.withLock(
    { jobName: 'hold-expiry', owner: options.owner, now },
    () => hold.releaseExpired(now, 200, ctx),
  );
  return outcome.ran ? { ran: true, released: outcome.result } : { ran: false, released: 0 };
};
