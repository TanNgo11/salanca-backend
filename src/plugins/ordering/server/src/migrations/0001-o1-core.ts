import type { OrderingMigration } from './runner';

/**
 * O1 base objects Strapi schema sync cannot express: the order-code sequence, composite unique
 * constraints and partial indexes. Table names are the `collectionName`s from
 * `content-types/internal.ts`; every statement is idempotent.
 */
export const o1CoreMigration: OrderingMigration = {
  name: '0001-o1-core',
  async up(trx) {
    await trx.raw('CREATE SEQUENCE IF NOT EXISTS plugins_ordering_order_code_seq');
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_payment_event_provider_txn_uq
       ON plugins_ordering_payment_event (provider_code, provider_transaction_id)`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_idempotency_key_scope_key_uq
       ON plugins_ordering_idempotency_key (scope, key)`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_order_job_lock_job_shard_uq
       ON plugins_ordering_order_job_lock (job_name, shard_key)`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_ops_alert_open_dedupe_uq
       ON plugins_ordering_ops_alert (dedupe_key) WHERE status = 'open'`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_order_location_business_idx
       ON plugins_ordering_order (location_ref, business_date)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_order_status_idx
       ON plugins_ordering_order (status)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_outbox_pending_available_idx
       ON plugins_ordering_outbox (available_at) WHERE delivered_at IS NULL AND failed_at IS NULL`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_hold_open_expires_idx
       ON plugins_ordering_hold (expires_at) WHERE released_at IS NULL`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_order_event_occurred_idx
       ON plugins_ordering_order_event (occurred_at)`,
    );
  },
};
