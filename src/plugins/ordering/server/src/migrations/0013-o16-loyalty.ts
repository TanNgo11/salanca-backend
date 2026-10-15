import type { OrderingMigration } from './runner';

/**
 * O16 structures Strapi cannot express. The loyalty lot and ledger keep `customer_id`,
 * `order_id` and `lot_id` as plain integer columns (Strapi relations live in `*_lnk` tables, which
 * cannot carry unique or partial indexes), so everything the invariants need sits here:
 * one `earn` per order, one `redeem` per (order, lot), `0 ≤ remaining ≤ points` on a lot, a unique
 * tier code and the scans the expiry, tier and report jobs run.
 *
 * `release` has no (order, lot) unique index on purpose: a staff edit can hand back part of an order's
 * points and a later cancel the rest, both to the same lot. Release stays idempotent in the service
 * (it hands back `Σ redeem − Σ release` of the order under the order mutex).
 */
export const o16LoyaltyMigration: OrderingMigration = {
  name: '0013-o16-loyalty',
  async up(trx) {
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_loyalty_tier_code_uq
       ON plugins_ordering_loyalty_tier (code)`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_loyalty_ledger_earn_uq
       ON plugins_ordering_loyalty_ledger (order_id) WHERE kind = 'earn'`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_loyalty_ledger_redeem_uq
       ON plugins_ordering_loyalty_ledger (order_id, lot_id) WHERE kind = 'redeem'`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_loyalty_lot_earn_uq
       ON plugins_ordering_loyalty_lot (order_id) WHERE source = 'earn'`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_loyalty_lot_customer_expiry_idx
       ON plugins_ordering_loyalty_lot (customer_id, expires_at) WHERE remaining > 0`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_loyalty_lot_expiry_idx
       ON plugins_ordering_loyalty_lot (expires_at) WHERE remaining > 0`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_loyalty_ledger_customer_at_idx
       ON plugins_ordering_loyalty_ledger (customer_id, at)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_loyalty_ledger_kind_at_idx
       ON plugins_ordering_loyalty_ledger (kind, at)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_loyalty_ledger_order_idx
       ON plugins_ordering_loyalty_ledger (order_id)`,
    );
    // The release sweep looks for canceled orders whose redeemed points were never handed back.
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_loyalty_ledger_redeem_order_idx
       ON plugins_ordering_loyalty_ledger (order_id) WHERE kind IN ('redeem', 'release')`,
    );
    await trx.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'plugins_ordering_loyalty_lot_remaining_ck'
        ) THEN
          ALTER TABLE plugins_ordering_loyalty_lot
            ADD CONSTRAINT plugins_ordering_loyalty_lot_remaining_ck
            CHECK (remaining >= 0 AND remaining <= points);
        END IF;
      END $$;
    `);
  },
};
