import type { OrderingMigration } from './runner';

/**
 * O14 indexes Strapi cannot express, plus the channel vocabulary change. `web-checkout` meant
 * "the public menu" and becomes no channel rule; `phone-staff` becomes `staff`.
 */
export const o14PriceListsMigration: OrderingMigration = {
  name: '0009-o14-price-lists',
  async up(trx) {
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_customer_group_code_uq
       ON plugins_ordering_customer_group (upper(code))`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_customer_group_member_pair_uq
       ON plugins_ordering_customer_group_member (customer_id, group_document_id)`,
    );
    await trx.raw(
      `UPDATE plugins_ordering_catalog_price
       SET rules = (rules::jsonb - 'channel')
       WHERE jsonb_typeof(rules::jsonb) = 'object' AND rules::jsonb->>'channel' = 'web-checkout'`,
    );
    await trx.raw(
      `UPDATE plugins_ordering_catalog_price
       SET rules = jsonb_set(rules::jsonb, '{channel}', '"staff"')
       WHERE jsonb_typeof(rules::jsonb) = 'object' AND rules::jsonb->>'channel' = 'phone-staff'`,
    );
  },
};
