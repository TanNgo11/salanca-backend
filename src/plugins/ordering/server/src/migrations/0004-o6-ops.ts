import type { OrderingMigration } from './runner';

/**
 * O6 ops indexes and the refund business-date backfill. Runs in bootstrap AFTER Strapi schema
 * sync, so `plugins_ordering_cash_closing` and `refund.business_date` already exist here.
 * The backfill stamps `business_date` on settled cash refunds with the Ho_Chi_Minh timezone and
 * the 04:00 cutoff — every seeded branch uses exactly that; older settled rows only exist in
 * test databases.
 */
export const o6OpsMigration: OrderingMigration = {
  name: '0004-o6-ops',
  async up(trx) {
    // One "current" closing per (branch, day, collector) — a double-submit loses to 409.
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_cash_closing_current_uq
       ON plugins_ordering_cash_closing (location_ref, business_date, collector_ref)
       WHERE status = 'current'`,
    );
    // The cash-closing summary scans payments by (provider, business date).
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_payment_cash_day_idx
       ON plugins_ordering_payment (provider_code, business_date)`,
    );
    // The alert inbox lists by status + latest sighting.
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_ops_alert_status_seen_idx
       ON plugins_ordering_ops_alert (status, last_seen_at)`,
    );
    await trx.raw(
      `UPDATE plugins_ordering_refund
       SET business_date = ((settled_at AT TIME ZONE 'Asia/Ho_Chi_Minh') - interval '4 hours')::date
       WHERE status = 'settled' AND settled_at IS NOT NULL AND business_date IS NULL`,
    );
  },
};
