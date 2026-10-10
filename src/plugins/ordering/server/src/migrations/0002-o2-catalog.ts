import type { OrderingMigration } from './runner';

/**
 * O2 catalog indexes Strapi cannot express (contracts §21.9 — `unique: true` never reaches the
 * database). Slug uniqueness is per (entityType, locale) so the same slug may exist in another
 * locale; SKU allows many NULLs (variants without a SKU).
 */
export const o2CatalogMigration: OrderingMigration = {
  name: '0002-o2-catalog',
  async up(trx) {
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_catalog_slug_locale_uq
       ON plugins_ordering_catalog_slug (entity_type, locale, slug)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_catalog_slug_entity_idx
       ON plugins_ordering_catalog_slug (entity_type, entity_document_id)`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_catalog_location_state_uq
       ON plugins_ordering_catalog_location_state (entity_type, entity_document_id, location_ref)`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_catalog_variant_sku_uq
       ON plugins_ordering_catalog_variant (sku)`,
    );
    // The storefront list endpoint scans status + sell_online; keep it indexed from day one.
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_catalog_product_online_idx
       ON plugins_ordering_catalog_product (status, sell_online)`,
    );
  },
};
