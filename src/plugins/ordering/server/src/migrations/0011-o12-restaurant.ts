import type { OrderingMigration } from './runner';

/**
 * O12 indexes Strapi cannot express: branch-unique table codes, the single-open-session-per-table
 * invariant, and lookup indexes for the public token route and session listings.
 *
 * Strapi 5 relations live in `*_lnk` join tables, so `table_session` has no `table_id` column to
 * index. `open_table_id` is a denormalized copy of the linked table id that the service writes at
 * session open and clears at close (raw SQL — Strapi strips undeclared attributes). A plain UNIQUE
 * index on it gives "one open session per table" because Postgres treats NULLs as distinct.
 */
export const o12RestaurantMigration: OrderingMigration = {
  name: '0011-o12-restaurant',
  async up(trx) {
    await trx.raw(
      `ALTER TABLE plugins_ordering_table_session
       ADD COLUMN IF NOT EXISTS open_table_id bigint`,
    );
    await trx.raw(
      `UPDATE plugins_ordering_table_session s
       SET open_table_id = l.dining_table_id
       FROM plugins_ordering_table_session_table_lnk l
       WHERE s.status = 'open' AND s.id = l.table_session_id AND s.open_table_id IS NULL`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_table_session_open_uq
       ON plugins_ordering_table_session (open_table_id)`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_dining_table_code_uq
       ON plugins_ordering_dining_table (location_ref, code)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_dining_table_token_idx
       ON plugins_ordering_dining_table (qr_token_hash)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_table_session_list_idx
       ON plugins_ordering_table_session (location_ref, status)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_order_table_session_idx
       ON plugins_ordering_order_table_session_lnk (table_session_id)`,
    );
  },
};
