import type { OrderingMigration } from './runner';

/**
 * O9 structures Strapi cannot express: unique code hash (the only lookup of a card),
 * `balance >= 0` as the hard money invariant, and the indexes the list, search, batch
 * and expiry scans need. Relations live in Strapi `*_lnk` link tables, so the ledger's
 * "by card" index sits on `plugins_ordering_gift_card_ledger_card_lnk` plus `at` on the
 * ledger itself. The ledger gets no update/delete routes — that rule is enforced by
 * convention plus the gift-card-ledger script.
 */
export const o9GiftCardsMigration: OrderingMigration = {
  name: '0010-o9-gift-cards',
  async up(trx) {
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_gift_card_code_hash_uq
       ON plugins_ordering_gift_card (code_hash)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_gift_card_status_expires_idx
       ON plugins_ordering_gift_card (status, expires_at)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_gift_card_last4_idx
       ON plugins_ordering_gift_card (last_4)`,
    );
    // Retention job: sealedCode cleanup scans unsealed cards older than 24h.
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_gift_card_sealed_idx
       ON plugins_ordering_gift_card (issued_at) WHERE sealed_code IS NOT NULL`,
    );
    // Batch → its cards (activation lists) and order → cards issued by it (order detail).
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_gift_card_batch_lnk_batch_idx
       ON plugins_ordering_gift_card_batch_lnk (gift_card_batch_id)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_gift_card_order_lnk_order_idx
       ON plugins_ordering_gift_card_order_lnk (order_id)`,
    );
    // Ledger of one card, chronological: link side by card, ledger side by time.
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_gift_card_ledger_card_lnk_card_idx
       ON plugins_ordering_gift_card_ledger_card_lnk (gift_card_id)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_gift_card_ledger_at_idx
       ON plugins_ordering_gift_card_ledger (at)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_gift_card_ledger_kind_at_idx
       ON plugins_ordering_gift_card_ledger (kind, at)`,
    );
    await trx.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'plugins_ordering_gift_card_balance_ck'
        ) THEN
          ALTER TABLE plugins_ordering_gift_card
            ADD CONSTRAINT plugins_ordering_gift_card_balance_ck
            CHECK (balance >= 0);
        END IF;
      END $$;
    `);
  },
};
