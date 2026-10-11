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
  return service;
};

export default alert;
