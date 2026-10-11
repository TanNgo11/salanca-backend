import type { Core } from '@strapi/strapi';

import type outboxFactory from './outbox';
import type { ServiceContext } from './context';
import { nowOf } from './context';

const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: string }).code === '23505' ||
  (error as { cause?: { code?: string } }).cause?.code === '23505';

type AlertRow = { id: number; count: number; status: string };

/**
 * Operational alerts (contracts §12, §19.9; plan step 12, first version). One open alert per
 * `dedupeKey` — the partial unique index from migration 0001 makes concurrent openers converge on
 * the same row, which only bumps `count`/`lastSeenAt`. The first open enqueues `ops-alert.opened`
 * so the notification consumer can email the branch. Rows hold refs only, never PII.
 */
const alert = ({ strapi }: { strapi: Core.Strapi }) => {
  const alerts = () => strapi.db.query('plugin::ordering.ops-alert');
  const outbox = () => strapi.plugin('ordering').service('outbox') as ReturnType<typeof outboxFactory>;

  const service = {
    async open(
      input: {
        alertCode: string;
        dedupeKey: string;
        severity?: 'info' | 'warning' | 'critical';
        aggregateRef?: string;
        locationRef?: string;
      },
      ctx: ServiceContext,
    ): Promise<{ id: number; opened: boolean }> {
      const now = nowOf(ctx);
      const existing = (await alerts().findOne({
        where: { dedupeKey: input.dedupeKey, status: 'open' },
      })) as AlertRow | null;
      if (existing) {
        await alerts().update({
          where: { id: existing.id },
          data: { count: existing.count + 1, lastSeenAt: now },
        });
        return { id: existing.id, opened: false };
      }
      try {
        return await strapi.db.transaction(async () => {
          const row = (await alerts().create({
            data: {
              alertCode: input.alertCode,
              dedupeKey: input.dedupeKey,
              severity: input.severity ?? 'warning',
              aggregateRef: input.aggregateRef ?? null,
              status: 'open',
              firstSeenAt: now,
              lastSeenAt: now,
              count: 1,
            },
          })) as AlertRow;
          await outbox().enqueue(
            {
              type: 'ops-alert.opened',
              aggregateType: 'ops-alert',
              aggregateId: String(row.id),
              payload: {
                alertId: row.id,
                alertCode: input.alertCode,
                aggregateRef: input.aggregateRef ?? null,
                locationRef: input.locationRef ?? null,
              },
              uniqueKey: `ops-alert.opened:${row.id}`,
            },
            ctx,
          );
          return { id: row.id, opened: true };
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const winner = (await alerts().findOne({
          where: { dedupeKey: input.dedupeKey, status: 'open' },
        })) as AlertRow | null;
        if (!winner) throw error;
        await alerts().update({ where: { id: winner.id }, data: { count: winner.count + 1, lastSeenAt: now } });
        return { id: winner.id, opened: false };
      }
    },

    /** Resolves the open alert of a key once its condition is gone (e.g. the order was accepted). */
    async resolve(dedupeKey: string, ctx: ServiceContext): Promise<boolean> {
      const { count } = await alerts().updateMany({
        where: { dedupeKey, status: { $in: ['open', 'acknowledged'] } },
        data: { status: 'resolved', resolvedAt: nowOf(ctx) },
      });
      return count > 0;
    },
  };

  const store = () => strapi.store({ type: 'plugin', name: 'ordering' });
  const failureCount = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
  };

  /** Five bad signatures in a row open `webhook-failing:<provider>`. A good webhook resets it. */
  const noteWebhookFailure = async (
    providerCode: string,
    ctx: ServiceContext,
  ): Promise<{ failures: number; opened: boolean }> => {
    const storeKey = `webhook-failures:${providerCode}`;
    const failures = failureCount(await store().get({ key: storeKey })) + 1;
    await store().set({ key: storeKey, value: String(failures) });
    if (failures < 5) return { failures, opened: false };
    const severity = failures >= 20 ? 'critical' : 'warning';
    const result = await service.open(
      {
        alertCode: 'webhook-failing',
        dedupeKey: `webhook-failing:${providerCode}`,
        severity,
        aggregateRef: `provider:${providerCode}`,
      },
      ctx,
    );
    if (severity === 'critical') {
      await alerts().update({ where: { id: result.id }, data: { severity: 'critical' } });
    }
    return { failures, opened: result.opened };
  };

  const noteWebhookSuccess = async (providerCode: string, ctx: ServiceContext): Promise<void> => {
    await store().set({ key: `webhook-failures:${providerCode}`, value: '0' });
    await service.resolve(`webhook-failing:${providerCode}`, ctx);
  };

  /** One open alert per provider while unmatched transfers keep arriving. */
  const noteUnmatched = async (
    providerCode: string,
    ctx: ServiceContext,
  ): Promise<{ id: number; opened: boolean }> =>
    service.open(
      {
        alertCode: 'payment-unmatched',
        dedupeKey: `payment-unmatched:${providerCode}`,
        severity: 'warning',
        aggregateRef: `provider:${providerCode}`,
      },
      ctx,
    );

  /** One open alert per provider transaction the reconciliation could not apply. */
  const noteReconciliationMismatch = async (
    input: { providerCode: string; providerTransactionId: string },
    ctx: ServiceContext,
  ): Promise<{ id: number; opened: boolean }> =>
    service.open(
      {
        alertCode: 'reconciliation-mismatch',
        dedupeKey: `reconciliation-mismatch:${input.providerCode}:${input.providerTransactionId}`,
        severity: 'warning',
        aggregateRef: `provider:${input.providerCode}`,
      },
      ctx,
    );

  return {
    ...service,
    noteWebhookFailure,
    noteWebhookSuccess,
    noteUnmatched,
    noteReconciliationMismatch,
  };
};

export default alert;
