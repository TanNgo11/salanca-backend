import { randomBytes } from 'node:crypto';

import type { Core } from '@strapi/strapi';

const TABLE = 'plugins_ordering_order_job_lock';

/** Strapi-style document id: 24 chars of base36-ish entropy (format is opaque to the job lock). */
const documentId = () => randomBytes(18).toString('base64url').slice(0, 24);

/**
 * Cross-process job lease. Acquire = insert-if-missing then fenced update on an expired lease;
 * release clears the lease (and records success or the error message — never payload data).
 * A second holder while `expires_at` is in the future gets `{ ran: false, reason: 'locked' }`.
 * Every run — success or failure — also stamps `last_run_at`/`last_duration_ms` so the ops
 * screen can show "last ran" even for a job that errored.
 */
const jobLock = ({ strapi }: { strapi: Core.Strapi }) => ({
  async withLock<T>(
    input: {
      jobName: string;
      shardKey?: string;
      owner: string;
      leaseSeconds?: number;
      now?: Date;
    },
    fn: () => Promise<T>,
  ): Promise<{ ran: true; result: T } | { ran: false; reason: 'locked' }> {
    const now = input.now ?? new Date();
    const shardKey = input.shardKey ?? 'default';
    const leaseSeconds = input.leaseSeconds ?? 300;
    const expiresAt = new Date(now.getTime() + leaseSeconds * 1000);
    const db = strapi.db.connection;

    await db.raw(
      `INSERT INTO ${TABLE}
         (job_name, shard_key, attempts, document_id, created_at, updated_at)
       VALUES (?, ?, 0, ?, ?, ?)
       ON CONFLICT (job_name, shard_key) DO NOTHING`,
      [input.jobName, shardKey, documentId(), now, now],
    );

    const { rows } = await db.raw(
      `UPDATE ${TABLE}
       SET owner = ?, locked_at = ?, expires_at = ?, attempts = attempts + 1, updated_at = ?
       WHERE job_name = ? AND shard_key = ?
         AND (expires_at IS NULL OR expires_at < ?)
       RETURNING id`,
      [input.owner, now, expiresAt, now, input.jobName, shardKey, now],
    );
    if (rows.length === 0) return { ran: false as const, reason: 'locked' as const };

    const startedAt = new Date();
    const finished = () => {
      const done = new Date();
      return { done, durationMs: done.getTime() - startedAt.getTime() };
    };
    try {
      const result = await fn();
      const end = finished();
      await db(TABLE)
        .where({ job_name: input.jobName, shard_key: shardKey, owner: input.owner })
        .update({
          owner: null,
          expires_at: null,
          last_run_at: startedAt,
          last_duration_ms: end.durationMs,
          last_success_at: end.done,
          last_error: null,
          attempts: 0,
          updated_at: end.done,
        });
      return { ran: true as const, result };
    } catch (error) {
      const end = finished();
      await db(TABLE)
        .where({ job_name: input.jobName, shard_key: shardKey, owner: input.owner })
        .update({
          owner: null,
          expires_at: null,
          last_run_at: startedAt,
          last_duration_ms: end.durationMs,
          last_error: String((error as Error)?.message ?? error).slice(0, 500),
          updated_at: end.done,
        });
      throw error;
    }
  },

  /**
   * Heartbeat for jobs that run WITHOUT a lock (the outbox dispatcher is intentionally
   * lock-free): upserts the (job_name, shard_key) row so `job-heartbeat-missed` still sees a
   * pulse. Success sets `last_success_at` and clears `last_error`; failure stores only the
   * message — never payload data.
   */
  async heartbeat(input: {
    jobName: string;
    shardKey?: string;
    startedAt: Date;
    error?: unknown;
  }): Promise<void> {
    const shardKey = input.shardKey ?? 'default';
    const finishedAt = new Date();
    const durationMs = Math.max(0, finishedAt.getTime() - input.startedAt.getTime());
    const outcome =
      input.error === undefined
        ? { last_success_at: finishedAt, last_error: null }
        : { last_error: String((input.error as Error)?.message ?? input.error).slice(0, 500) };
    await strapi.db.connection.raw(
      `INSERT INTO ${TABLE}
         (job_name, shard_key, attempts, document_id, created_at, updated_at,
          last_run_at, last_duration_ms, last_success_at, last_error)
       VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (job_name, shard_key) DO UPDATE SET
         last_run_at = EXCLUDED.last_run_at,
         last_duration_ms = EXCLUDED.last_duration_ms,
         last_success_at = COALESCE(EXCLUDED.last_success_at, ${TABLE}.last_success_at),
         last_error = EXCLUDED.last_error,
         updated_at = EXCLUDED.updated_at`,
      [
        input.jobName,
        shardKey,
        documentId(),
        finishedAt,
        finishedAt,
        input.startedAt,
        durationMs,
        outcome.last_success_at ?? null,
        outcome.last_error ?? null,
      ],
    );
  },
});

export default jobLock;
