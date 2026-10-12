import type { Core } from '@strapi/strapi';

import type alertFactory from '../services/alert';
import type alertRulesFactory from '../services/alert-rules';
import type { ServiceContext } from '../services/context';
import type jobLockFactory from '../services/job-lock';

const HOUR_MS = 60 * 60 * 1000;
const LIMIT = 200;

type ManualEvent = {
  id: number;
  receivedAt: string | Date | null;
  rawPayload: unknown;
};

const payloadOf = (value: unknown): { confirmed?: unknown; transferredAt?: unknown } =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as { confirmed?: unknown; transferredAt?: unknown })
    : {};

/** Staff-typed time when it parses; otherwise the moment the row was stored. */
const ageOf = (row: ManualEvent): Date | null => {
  const raw = payloadOf(row.rawPayload);
  if (typeof raw.transferredAt === 'string') {
    const transferredAt = new Date(raw.transferredAt);
    if (!Number.isNaN(transferredAt.getTime())) return transferredAt;
  }
  if (row.receivedAt) {
    const receivedAt = new Date(row.receivedAt);
    if (!Number.isNaN(receivedAt.getTime())) return receivedAt;
  }
  return null;
};

/**
 * `manual-payment-unconfirmed` (contracts §19.1): a staff-recorded transfer SePay has not
 * confirmed within the rule's `threshold` hours (default 24) opens one alert per event;
 * `criticalThreshold` hours escalates it to critical. Confirmation resolves it.
 * The bank reference stays out of the alert and the log.
 */
export const runManualPaymentCheck = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<{ ran: boolean; opened: number; resolved: number }> => {
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const alerts = plugin.service('alert') as ReturnType<typeof alertFactory>;
  const alertRules = plugin.service('alert-rules') as ReturnType<typeof alertRulesFactory>;
  const rule = await alertRules.ruleOf('manual-payment-unconfirmed');
  const now = options.now ?? new Date();
  const ctx: ServiceContext = { actor: { kind: 'system', actorRef: 'job:manual-payment-check' }, now };
  const cutoff = now.getTime() - rule.threshold * HOUR_MS;

  const outcome = await jobLock.withLock(
    { jobName: 'manual-payment-check', owner: options.owner, now },
    async () => {
      let opened = 0;
      let resolved = 0;
      const rows = (await strapi.db.query('plugin::ordering.payment-event').findMany({
        where: { providerCode: 'sepay', kind: 'manual' },
        limit: LIMIT,
      })) as ManualEvent[];
      const still = new Set<string>();
      for (const row of rows) {
        const raw = payloadOf(row.rawPayload);
        if (raw.confirmed === true) continue;
        const at = ageOf(row);
        if (!at || at.getTime() > cutoff) continue;
        const key = `manual-payment-unconfirmed:${row.id}`;
        still.add(key);
        const ageHours = (now.getTime() - at.getTime()) / HOUR_MS;
        const result = await alerts.open(
          {
            alertCode: 'manual-payment-unconfirmed',
            dedupeKey: key,
            severity:
              rule.criticalThreshold !== undefined && ageHours > rule.criticalThreshold
                ? 'critical'
                : 'warning',
            aggregateRef: `payment-event:${row.id}`,
          },
          ctx,
        );
        if (result.opened) opened += 1;
      }
      const open = (await strapi.db.query('plugin::ordering.ops-alert').findMany({
        where: { alertCode: 'manual-payment-unconfirmed', status: { $in: ['open', 'acknowledged'] } },
        select: ['dedupeKey'],
      })) as Array<{ dedupeKey: string }>;
      for (const row of open) {
        if (!still.has(row.dedupeKey) && (await alerts.resolve(row.dedupeKey, ctx))) resolved += 1;
      }
      return { opened, resolved };
    },
  );

  if (!outcome.ran) return { ran: false, opened: 0, resolved: 0 };
  strapi.log.info(
    `[ordering] manual payment check opened=${outcome.result.opened} resolved=${outcome.result.resolved}`,
  );
  return { ran: true, opened: outcome.result.opened, resolved: outcome.result.resolved };
};
