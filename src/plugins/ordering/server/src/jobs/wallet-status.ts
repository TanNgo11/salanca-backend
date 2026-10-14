import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { OrderingError } from '../domain/errors';
import type { JsonObject } from '../contracts/common';
import type alertFactory from '../services/alert';
import type { ServiceContext } from '../services/context';
import type jobLockFactory from '../services/job-lock';
import type paymentMatchingFactory from '../services/payment-matching';
import type { OrderingRegistry } from '../services/registry';

/** Pending sessions younger than this are left alone — an in-flight IPN would race the poll. */
const GRACE_MS = 60_000;
/**
 * Sessions older than this are abandoned (MoMo/VNPay sessions expire in ~15 minutes): one
 * last query, then — unless it shows money moved — the payment is cancelled so it leaves the
 * pending set. Without this, 50 abandoned rows filled every batch forever.
 */
const ABANDON_MS = 2 * 60 * 60_000;
const BATCH = 50;

type PendingPayment = {
  id: number;
  providerCode: string;
  providerReference: string | null;
  session: JsonObject | null;
};

/**
 * O13 wallet catch-up (`wallet-status-check`). MoMo/VNPay have no transaction-list API —
 * reconciliation IS a per-reference status query for pending sessions whose IPN never
 * arrived. A terminal answer goes through the normal ingest path (idempotent on the
 * provider transaction id, so a late IPN replay is a no-op). A provider outage fails the
 * whole sweep next tick; a single malformed answer only parks that payment.
 */
export const runWalletStatusCheck = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<{ ran: boolean; checked: number; applied: number }> => {
  const plugin = strapi.plugin('ordering');
  const config = strapi.config.get('plugin::ordering') as OrderingConfig;
  const registry = plugin.service('registry') as OrderingRegistry;
  const walletProviders = registry
    .paymentProviders()
    .filter(
      (provider) =>
        provider.capabilities.includes('wallet') &&
        typeof provider.queryTransaction === 'function' &&
        config.providers.payment[provider.code]?.enabled === true,
    );
  if (walletProviders.length === 0) return { ran: true, checked: 0, applied: 0 };
  const codes = walletProviders.map((provider) => provider.code);

  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const matching = plugin.service('payment-matching') as ReturnType<typeof paymentMatchingFactory>;
  const alerts = plugin.service('alert') as ReturnType<typeof alertFactory>;
  const now = options.now ?? new Date();
  const ctx: ServiceContext = { actor: { kind: 'system', actorRef: 'job:wallet-status-check' }, now };

  const outcome = await jobLock.withLock(
    { jobName: 'wallet-status-check', owner: options.owner, now },
    async () => {
      const payments = strapi.db.query('plugin::ordering.payment');
      const abandonBefore = new Date(now.getTime() - ABANDON_MS).toISOString();
      const pendingWhere = {
        status: 'pending',
        providerCode: { $in: codes },
        providerReference: { $notNull: true },
      };
      // Abandoned sessions first (bounded), then live ones least-recently checked first, so
      // every pending session gets its turn.
      const abandoned = (await payments.findMany({
        where: { ...pendingWhere, createdAt: { $lte: abandonBefore } },
        orderBy: { id: 'asc' },
        limit: BATCH,
      })) as PendingPayment[];
      const live = (await payments.findMany({
        where: {
          ...pendingWhere,
          createdAt: { $gt: abandonBefore, $lt: new Date(now.getTime() - GRACE_MS).toISOString() },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        limit: BATCH,
      })) as PendingPayment[];
      const abandonedIds = new Set(abandoned.map((row) => row.id));
      const rows = [...abandoned, ...live];
      let applied = 0;
      for (const row of rows) {
        const provider = registry.paymentProvider(row.providerCode);
        const giveUp = async () => {
          if (!abandonedIds.has(row.id)) {
            // Rotate: the next tick starts with other sessions.
            await payments.update({ where: { id: row.id }, data: { updatedAt: now } });
            return;
          }
          await payments.update({
            where: { id: row.id, status: 'pending' },
            data: { status: 'cancelled', actorRef: 'job:wallet-status-check' },
          });
        };
        let event;
        try {
          event = await provider.queryTransaction?.(row.providerReference ?? '', {
            session: row.session ?? {},
          });
        } catch (error) {
          // One bad payment must not abort the sweep — it retries next tick (or, when
          // abandoned, is closed: "not found" means the customer never paid).
          if (!(error instanceof OrderingError)) throw error;
          strapi.log.warn(
            `[ordering] wallet-status ${row.providerCode} query failed: ${error.code}`,
          );
          await giveUp();
          continue;
        }
        if (!event || event.kind !== 'capture') {
          if (event) {
            const saved = await matching.ingest({ event, rawPayload: { source: 'wallet-status-check' } }, ctx);
            if (!saved.duplicate) applied += 1;
          }
          await giveUp();
          continue;
        }
        const saved = await matching.ingest(
          { event, rawPayload: { source: 'wallet-status-check' } },
          ctx,
        );
        if (!saved.duplicate) {
          applied += 1;
          if (saved.decision.outcome === 'needs-review') {
            await alerts.noteUnmatched(event.providerCode, ctx);
          }
        }
      }
      return { checked: rows.length, applied };
    },
  );

  if (!outcome.ran) return { ran: false, checked: 0, applied: 0 };
  strapi.log.info(
    `[ordering] wallet-status checked=${outcome.result.checked} applied=${outcome.result.applied}`,
  );
  return { ran: true, ...outcome.result };
};
