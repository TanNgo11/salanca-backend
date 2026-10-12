import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { redactPayload } from '../domain/pii';
import type jobLockFactory from '../services/job-lock';

type RetentionResult = {
  ran: boolean;
  redacted: number;
  outboxDeleted: number;
  alertsDeleted: number;
  batches: number;
};

const daysAgo = (now: Date, days: number): Date =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

/**
 * Data-retention job (O6 step 6, contracts §19.9). Redacts payment-event raw payloads to
 * the reconciliation allowlist and deletes aged outbox/alert rows — bounded batches so a
 * backlog never turns into one giant transaction; reruns are no-ops once caught up.
 */
export const runRetention = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<RetentionResult> => {
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const now = options.now ?? new Date();

  const outcome = await jobLock.withLock(
    { jobName: 'retention', owner: options.owner, now },
    async () => {
      const config = (strapi.config.get('plugin::ordering') as OrderingConfig).retention;
      const knex = strapi.db.connection;
      const redactedAt = now.toISOString();
      let redacted = 0;
      let outboxDeleted = 0;
      let alertsDeleted = 0;
      let batches = 0;

      // ── Payment-event payloads: keep the reconciliation allowlist only ─────────
      const payloadCutoff = daysAgo(now, config.paymentPayloadDays);
      for (let batch = 0; batch < config.maxBatchesPerRun; batch += 1) {
        const rows = (await knex('plugins_ordering_payment_event')
          .where('received_at', '<', payloadCutoff)
          .whereNotNull('raw_payload')
          .whereRaw(`raw_payload ->> 'redactedAt' IS NULL`)
          .orderBy('id')
          .limit(config.batchSize)
          .select('id', 'raw_payload')) as Array<{ id: number; raw_payload: unknown }>;
        if (rows.length === 0) break;
        batches += 1;
        for (const row of rows) {
          await knex('plugins_ordering_payment_event')
            .where({ id: row.id })
            .update({ raw_payload: JSON.stringify(redactPayload(row.raw_payload, redactedAt)) });
        }
        redacted += rows.length;
      }

      // ── Outbox: delivered rows age out faster than failed ones (kept for triage) ──
      const deleteOutbox = async (column: 'delivered_at' | 'failed_at', days: number) => {
        let removed = 0;
        const cutoff = daysAgo(now, days);
        for (let batch = 0; batch < config.maxBatchesPerRun; batch += 1) {
          const ids = (await knex('plugins_ordering_outbox')
            .where(column, '<', cutoff)
            .orderBy('id')
            .limit(config.batchSize)
            .select('id')) as Array<{ id: number }>;
          if (ids.length === 0) break;
          batches += 1;
          removed += await knex('plugins_ordering_outbox')
            .whereIn('id', ids.map((row) => row.id))
            .delete();
        }
        return removed;
      };
      outboxDeleted += await deleteOutbox('delivered_at', config.outboxDeliveredDays);
      outboxDeleted += await deleteOutbox('failed_at', config.outboxFailedDays);

      // ── Resolved alerts past their window ──────────────────────────────────────
      const alertCutoff = daysAgo(now, config.alertResolvedDays);
      for (let batch = 0; batch < config.maxBatchesPerRun; batch += 1) {
        const ids = (await knex('plugins_ordering_ops_alert')
          .where('status', 'resolved')
          .where('resolved_at', '<', alertCutoff)
          .orderBy('id')
          .limit(config.batchSize)
          .select('id')) as Array<{ id: number }>;
        if (ids.length === 0) break;
        batches += 1;
        alertsDeleted += await knex('plugins_ordering_ops_alert')
          .whereIn('id', ids.map((row) => row.id))
          .delete();
      }

      strapi.log.info(
        `[ordering] retention redacted=${redacted} outboxDeleted=${outboxDeleted} alertsDeleted=${alertsDeleted} batches=${batches}`,
      );
      return { redacted, outboxDeleted, alertsDeleted, batches };
    },
  );

  return outcome.ran
    ? { ran: true, ...(outcome.result as Omit<RetentionResult, 'ran'>) }
    : { ran: false, redacted: 0, outboxDeleted: 0, alertsDeleted: 0, batches: 0 };
};
