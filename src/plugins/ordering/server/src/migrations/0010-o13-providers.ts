import type { OrderingMigration } from './runner';

/**
 * O13 provider storage. Strapi sync creates the new columns on bootstrap; the explicit
 * IF-NOT-EXISTS ALTERs keep this migration a no-op there and cover databases where schema
 * sync is off. The `provider_reference` index backs the carrier webhook lookup
 * (`fulfillment(carrier_ref)` in the plan — providerReference holds the trip id).
 */
export const o13ProvidersMigration: OrderingMigration = {
  name: '0010-o13-providers',
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
  },
};
