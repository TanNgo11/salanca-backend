import type { OrderingMigration } from './runner';

/**
 * O8 indexes Strapi cannot express: case-insensitive code uniqueness, redemption lookup
 * by customer, one rating per order, and a phone expression index for the first-order
 * check. `CREATE INDEX CONCURRENTLY` cannot run inside the migration transaction; the
 * order table is still small at O8, so a regular index is enough.
 */
export const o8PromotionsRatingMigration: OrderingMigration = {
  name: '0008-o8-promotions-rating',
  async up(trx) {
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_promotion_code_code_uq
       ON plugins_ordering_promotion_code (upper(code))`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_promotion_redemption_customer_idx
       ON plugins_ordering_promotion_redemption (promotion_id, customer_key, status)`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_order_rating_order_uq
       ON plugins_ordering_order_rating (order_id)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_order_phone_idx
       ON plugins_ordering_order ((contact_snapshot->>'phone'))`,
    );
    await trx.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'plugins_ordering_promotion_used_count_ck'
        ) THEN
          ALTER TABLE plugins_ordering_promotion
            ADD CONSTRAINT plugins_ordering_promotion_used_count_ck
            CHECK (used_count >= 0);
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'plugins_ordering_promotion_code_used_count_ck'
        ) THEN
          ALTER TABLE plugins_ordering_promotion_code
            ADD CONSTRAINT plugins_ordering_promotion_code_used_count_ck
            CHECK (used_count >= 0);
        END IF;
      END $$;
    `);
  },
};
