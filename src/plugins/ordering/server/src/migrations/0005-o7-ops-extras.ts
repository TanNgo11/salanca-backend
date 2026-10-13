import type { OrderingMigration } from './runner';

/**
 * O7 daily-portion indexes Strapi cannot express (`unique: true` never reaches
 * Postgres). The data model names two unique keys: limit per entity+branch, and
 * usage per entity+branch+business date. Reservation lookups by order and line
 * are relations, so those indexes are the link-table indexes Strapi creates
 * (same shape as hold). The CHECKs keep a racing release from driving `reserved`
 * negative or releasing more than the row reserved.
 */
export const o7OpsExtrasMigration: OrderingMigration = {
  name: '0005-o7-ops-extras',
  async up(trx) {
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_catalog_daily_limit_uq
       ON plugins_ordering_catalog_daily_limit (entity_type, entity_document_id, location_ref)`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_catalog_daily_usage_uq
       ON plugins_ordering_catalog_daily_usage
       (entity_type, entity_document_id, location_ref, business_date)`,
    );
    await trx.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'plugins_ordering_catalog_daily_usage_reserved_ck'
        ) THEN
          ALTER TABLE plugins_ordering_catalog_daily_usage
            ADD CONSTRAINT plugins_ordering_catalog_daily_usage_reserved_ck
            CHECK (reserved >= 0);
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'plugins_ordering_catalog_daily_reservation_released_ck'
        ) THEN
          ALTER TABLE plugins_ordering_catalog_daily_reservation
            ADD CONSTRAINT plugins_ordering_catalog_daily_reservation_released_ck
            CHECK (released_quantity <= quantity);
        END IF;
      END $$;
    `);
  },
};
