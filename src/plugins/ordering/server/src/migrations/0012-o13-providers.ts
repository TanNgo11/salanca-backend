import type { OrderingMigration } from './runner';

/**
 * O13 provider storage. Strapi sync creates the new columns on bootstrap; the explicit
 * IF-NOT-EXISTS ALTERs keep this migration a no-op there and cover databases where schema
 * sync is off. The `provider_reference` index backs the carrier webhook lookup
 * (`fulfillment(carrier_ref)` in the plan — providerReference holds the trip id).
 */
export const o13ProvidersMigration: OrderingMigration = {
  name: '0012-o13-providers',
  async up(trx) {
    await trx.raw(
      `ALTER TABLE plugins_ordering_payment
         ADD COLUMN IF NOT EXISTS session jsonb`,
    );
    await trx.raw(
      `ALTER TABLE plugins_ordering_fulfillment
         ADD COLUMN IF NOT EXISTS carrier_status varchar(255)`,
    );
    await trx.raw(
      `ALTER TABLE plugins_ordering_fulfillment
         ADD COLUMN IF NOT EXISTS carrier_fee integer`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_fulfillment_provider_ref_idx
       ON plugins_ordering_fulfillment (provider_reference)
       WHERE provider_reference IS NOT NULL`,
    );
    // O13 step 6: provider message id + cost estimate on the delivery log; one channel rule
    // per template (Strapi sync creates the `notification_channel_rule` table itself).
    await trx.raw(
      `ALTER TABLE plugins_ordering_notification_delivery
         ADD COLUMN IF NOT EXISTS provider_message_id varchar(255)`,
    );
    await trx.raw(
      `ALTER TABLE plugins_ordering_notification_delivery
         ADD COLUMN IF NOT EXISTS cost_estimate integer`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_notification_channel_rule_uq
       ON plugins_ordering_notification_channel_rule (template)`,
    );
  },
};
