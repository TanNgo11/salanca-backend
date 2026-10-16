import type { OrderingMigration } from './runner';

const CUSTOMER = 'plugins_ordering_customer';
const ORDER = 'plugins_ordering_order';
const LINK = 'plugins_ordering_order_customer_lnk';

/**
 * BUG-02: `refreshStats` once added bigint strings, so `total_spent` holds concatenated digits.
 * Recomputes the stats of every customer that has completed orders, net of line cancels
 * (`payableTotal`). Idempotent — the values are recomputed, not incremented. 0007 stays untouched.
 */
export const o11CustomerStatsRecomputeMigration: OrderingMigration = {
  name: '0014-o11-customer-stats-recompute',
  async up(trx) {
    await trx.raw(
      `UPDATE ${CUSTOMER} c SET
         order_count = s.n,
         total_spent = s.total,
         last_order_at = s.last_at
       FROM (
         SELECT l.customer_id,
                COUNT(*) AS n,
                COALESCE(SUM(GREATEST(0, o.total_amount - COALESCE(o.canceled_amount, 0))), 0)::bigint AS total,
                MAX(o.placed_at) AS last_at
         FROM ${LINK} l
         JOIN ${ORDER} o ON o.id = l.order_id
         WHERE o.status = 'completed'
         GROUP BY l.customer_id
       ) s
       WHERE c.id = s.customer_id AND c.status <> 'erased'`,
    );
  },
};
