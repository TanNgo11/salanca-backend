import type { Core } from '@strapi/strapi';

import type giftCardFactory from '../services/gift-card';
import type jobLockFactory from '../services/job-lock';

/**
 * Daily card sweep (O9 step 6): every active card past `expiresAt` flips to `expired` and its
 * remaining balance is written off with an `expire` ledger row so `balance = Σ amount` keeps
 * holding. Serialized across instances by the job lock; reruns are no-ops because expired rows
 * leave the `active` filter.
 */
export const runGiftCardExpiry = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<{ ran: boolean; expired: number }> => {
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const giftCard = plugin.service('gift-card') as ReturnType<typeof giftCardFactory>;
  const now = options.now ?? new Date();
  const outcome = await jobLock.withLock({ jobName: 'gift-card-expiry', owner: options.owner, now }, () =>
    giftCard.expireDue(now, 500),
  );
  return outcome.ran ? { ran: true, expired: outcome.result } : { ran: false, expired: 0 };
};
