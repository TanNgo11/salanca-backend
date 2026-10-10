import { randomBytes } from 'node:crypto';

import type { Core } from '@strapi/strapi';

const TABLE = 'plugins_ordering_order_job_lock';

/** Strapi-style document id: 24 chars of base36-ish entropy (format is opaque to the job lock). */
const documentId = () => randomBytes(18).toString('base64url').slice(0, 24);

/**
 * Cross-process job lease. Acquire = insert-if-missing then fenced update on an expired lease;
 * release clears the lease (and records success or the error message — never payload data).
 * A second holder while `expires_at` is in the future gets `{ ran: false, reason: 'locked' }`.
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

    try {
      const result = await fn();
      await db(TABLE)
        .where({ job_name: input.jobName, shard_key: shardKey, owner: input.owner })
        .update({
          owner: null,
          expires_at: null,
          last_success_at: new Date(),
          last_error: null,
          attempts: 0,
          updated_at: new Date(),
        });
      return { ran: true as const, result };
    } catch (error) {
      await db(TABLE)
        .where({ job_name: input.jobName, shard_key: shardKey, owner: input.owner })
        .update({
          owner: null,
          expires_at: null,
          last_error: String((error as Error)?.message ?? error).slice(0, 500),
          updated_at: new Date(),
        });
      throw error;
    }
  },
});

export default jobLock;
