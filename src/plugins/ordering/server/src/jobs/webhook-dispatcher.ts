import type { Core } from '@strapi/strapi';

import type jobLockFactory from '../services/job-lock';
import type webhookDeliveryFactory from '../services/webhook-delivery';

/**
 * Webhook dispatcher entry point. Lock-free like the outbox dispatcher: delivery claims are
 * `FOR UPDATE SKIP LOCKED` + leases, so every running instance sends safely; a job lock would
 * needlessly serialize webhook traffic to one process. The heartbeat row still feeds
 * `job-heartbeat-missed` and the ops screen.
 */
export const runWebhookDispatcher = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<{ claimed: number; delivered: number; retried: number; failed: number }> => {
  const plugin = strapi.plugin('ordering');
  const delivery = plugin.service('webhook-delivery') as ReturnType<typeof webhookDeliveryFactory>;
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const startedAt = new Date();
  try {
    const result = await delivery.dispatch({ owner: options.owner, now: options.now });
    await jobLock.heartbeat({ jobName: 'webhook-dispatcher', startedAt });
    return result;
  } catch (error) {
    await jobLock.heartbeat({ jobName: 'webhook-dispatcher', startedAt, error });
    throw error;
  }
};
