import type { OrderingMigration } from './runner';

/**
 * O3 constraints Strapi cannot express: one delivery-log row per (event, template, recipient) so
 * a dispatcher re-run never sends twice, and lookups of the inbox by group status.
 */
export const o3PickupMigration: OrderingMigration = {
  name: '0003-o3-pickup',
  async up(trx) {
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_notification_delivery_uq
       ON plugins_ordering_notification_delivery (event_id, template, recipient_hash)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_fulfillment_group_status_idx
       ON plugins_ordering_fulfillment_group (status)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_hold_resource_open_idx
       ON plugins_ordering_hold (resource_ref) WHERE released_at IS NULL`,
    );
  },
};
