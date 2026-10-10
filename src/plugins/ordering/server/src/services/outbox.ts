import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { OutboxEvent } from '../contracts/outbox';
import type { OrderingConfig } from '../config';
import { maskPayload } from '../domain/pii';
import type { TransactionClient } from '../migrations/runner';
import { nowOf, type ServiceContext } from './context';
import type { OrderingRegistry } from './registry';

const TABLE = 'plugins_ordering_outbox';

export type OutboxRow = {
  id: number;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  uniqueKey: string;
  occurredAt: string;
  availableAt: string;
  attempts: number;
  lockedBy: string | null;
  lockedAt: string | null;
  leaseUntil: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  lastError: string | null;
};

export type DispatchResult = {
  claimed: number;
  delivered: number;
  retried: number;
  failed: number;
};

const toEvent = (row: OutboxRow): OutboxEvent => ({
  id: String(row.id),
  type: row.type,
  aggregateType: row.aggregateType,
  aggregateId: row.aggregateId,
  payload: row.payload as OutboxEvent['payload'],
  uniqueKey: row.uniqueKey,
  occurredAt: String(row.occurredAt),
  availableAt: String(row.availableAt),
  attempts: row.attempts,
  lockedAt: row.lockedAt ?? undefined,
  deliveredAt: row.deliveredAt ?? undefined,
  lastError: row.lastError ?? undefined,
});

/**
 * Transactional outbox. `enqueue` MUST be called inside the business transaction so the event
 * commits or rolls back with its state change. `claimBatch`/`deliver`/`dispatch` are the Step-12
 * dispatcher half: multi-instance safe via `FOR UPDATE SKIP LOCKED` + lease fencing, delivery is
 * at-least-once so consumers MUST be idempotent by event id.
 */
const outbox = ({ strapi }: { strapi: Core.Strapi }) => {
  const events = () => strapi.db.query('plugin::ordering.outbox');
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const registry = () =>
    strapi.plugin('ordering').service('registry') as OrderingRegistry;

  /**
   * Claims a batch for this owner: undelivered, unfailed, due, and unleased rows are locked
   * with a lease and their attempt counter is bumped — all inside one transaction using
   * `FOR UPDATE SKIP LOCKED` so concurrent dispatchers never grab the same row.
   */
  const claimBatch = async (input: {
    owner: string;
    now?: Date;
    batchSize?: number;
    leaseSeconds?: number;
  }): Promise<OutboxRow[]> => {
    const now = input.now ?? new Date();
    const batchSize = input.batchSize ?? config().outbox.batchSize;
    const leaseSeconds = input.leaseSeconds ?? config().outbox.leaseSeconds;
    const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
    const ids = await strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
      const { rows } = await trx.raw(
        `SELECT id FROM ${TABLE}
           WHERE delivered_at IS NULL AND failed_at IS NULL AND available_at <= ?
             AND (lease_until IS NULL OR lease_until < ?)
           ORDER BY id FOR UPDATE SKIP LOCKED LIMIT ?`,
        [now, now, batchSize],
      );
      const claimed = (rows as Array<{ id: number }>).map((row) => row.id);
      if (claimed.length === 0) return claimed;
      await trx.raw(
        `UPDATE ${TABLE}
           SET locked_by = ?, locked_at = ?, lease_until = ?, attempts = attempts + 1,
               updated_at = ?
           WHERE id = ANY(?)`,
        [input.owner, now, leaseUntil, now, claimed],
      );
      return claimed;
    });
    if (ids.length === 0) return [];
    return (await events().findMany({
      where: { id: { $in: ids } },
      orderBy: { id: 'asc' },
    })) as unknown as OutboxRow[];
  };

  /**
   * Runs the registered consumers for one claimed row. Success → delivered (fenced on
   * `locked_by` so a lost lease can never mark a row delivered). Failure → exponential
   * backoff until `maxAttempts`, then `failed_at`. `last_error` stores the message only —
   * never the payload (PII).
   */
  const deliver = async (
    row: OutboxRow,
    options: { owner: string; now?: Date },
  ): Promise<'delivered' | 'retried' | 'failed'> => {
    const now = options.now ?? new Date();
    const { maxAttempts, baseBackoffSeconds, maxBackoffSeconds } = config().outbox;
    try {
      for (const consumer of registry().outboxConsumers(row.type)) {
        await consumer(toEvent(row), { strapi });
      }
    } catch (error) {
      const lastError = String((error as Error)?.message ?? error).slice(0, 500);
      if (row.attempts >= maxAttempts) {
        await events().update({
          where: { id: row.id },
          data: {
            failedAt: now,
            lastError,
            lockedBy: null,
            lockedAt: null,
            leaseUntil: null,
          },
        });
        return 'failed';
      }
      const backoff = Math.min(baseBackoffSeconds * 2 ** (row.attempts - 1), maxBackoffSeconds);
      await events().update({
        where: { id: row.id },
        data: {
          availableAt: new Date(now.getTime() + backoff * 1000),
          lastError,
          lockedBy: null,
          lockedAt: null,
          leaseUntil: null,
        },
      });
      return 'retried';
    }
    const fenced = await strapi.db
      .connection(TABLE)
      .where({ id: row.id, locked_by: options.owner })
      .update({
        delivered_at: now,
        lease_until: null,
        locked_by: null,
        updated_at: now,
      });
    if (fenced === 0) {
      strapi.log.warn(`[ordering] outbox event ${row.id}: lease lost before delivery commit`);
      return 'retried';
    }
    return 'delivered';
  };

  return {
    async enqueue(
      input: {
        type: string;
        aggregateType: string;
        aggregateId: string;
        payload: Record<string, unknown>;
        uniqueKey?: string;
        availableAt?: Date;
      },
      ctx: ServiceContext,
    ): Promise<number> {
      const now = nowOf(ctx);
      const row = await events().create({
        data: {
          type: input.type,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          payload: maskPayload(input.payload),
          uniqueKey: input.uniqueKey ?? `${input.type}:${input.aggregateId}:${randomUUID()}`,
          occurredAt: now,
          availableAt: input.availableAt ?? now,
          attempts: 0,
        },
      });
      return row.id as number;
    },

    claimBatch,
    deliver,

    /** Claims and delivers batches until the queue drains or `maxBatches` is hit. */
    async dispatch(input: {
      owner: string;
      now?: Date;
      maxBatches?: number;
      batchSize?: number;
      leaseSeconds?: number;
      beforeDeliver?: (rows: OutboxRow[]) => Promise<void> | void;
    }): Promise<DispatchResult> {
      const totals: DispatchResult = { claimed: 0, delivered: 0, retried: 0, failed: 0 };
      const maxBatches = input.maxBatches ?? 20;
      for (let batch = 0; batch < maxBatches; batch += 1) {
        const rows = await claimBatch({
          owner: input.owner,
          now: input.now,
          batchSize: input.batchSize,
          leaseSeconds: input.leaseSeconds,
        });
        if (rows.length === 0) break;
        totals.claimed += rows.length;
        await input.beforeDeliver?.(rows);
        for (const row of rows) {
          const outcome = await deliver(row, { owner: input.owner, now: input.now });
          if (outcome === 'delivered') totals.delivered += 1;
          else if (outcome === 'retried') totals.retried += 1;
          else totals.failed += 1;
        }
      }
      return totals;
    },

    /** Cheap queue snapshot for the O6 ops surface. */
    async pendingStats(): Promise<{
      pending: number;
      oldestAvailableAt: string | null;
      failed: number;
    }> {
      const [pending, failed, oldest] = await Promise.all([
        events().count({
          where: { deliveredAt: null, failedAt: null },
        }),
        events().count({ where: { failedAt: { $notNull: true } } }),
        strapi.db
          .connection(TABLE)
          .whereNull('delivered_at')
          .whereNull('failed_at')
          .min('available_at as oldest')
          .first(),
      ]);
      return {
        pending: Number(pending),
        oldestAvailableAt: oldest?.oldest ? String(oldest.oldest) : null,
        failed: Number(failed),
      };
    },
  };
};

export default outbox;
