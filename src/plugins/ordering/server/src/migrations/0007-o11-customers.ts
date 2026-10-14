import { normalizeVietnamesePhone } from '../../../shared/contact/phone';
import { o11Hashing } from '../domain/customers/identity';
import { newDocumentId } from './document-id';
import type { OrderingMigration } from './runner';

const CUSTOMER = 'plugins_ordering_customer';
const ORDER = 'plugins_ordering_order';
const LINK = 'plugins_ordering_order_customer_lnk';
const BATCH = 500;

/**
 * O11 base objects Strapi schema sync cannot express: unique indexes on the lookup hashes, the
 * job-scan indexes, and the one-time backfill that links existing orders to a customer profile
 * created from `contactSnapshot.phone`. Batches of 500 orders keep the transaction short;
 * every statement is idempotent so a retried run converges.
 */
export const o11CustomersMigration: OrderingMigration = {
  name: '0007-o11-customers',
  async up(trx, strapi) {
    // --- unique + scan indexes ------------------------------------------------------
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_customer_phone_uq
       ON ${CUSTOMER} (phone) WHERE phone IS NOT NULL`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_customer_phone_hash_uq
       ON ${CUSTOMER} (phone_hash) WHERE phone_hash IS NOT NULL`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_customer_session_token_uq
       ON plugins_ordering_customer_session (token_hash)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_customer_session_expiry_idx
       ON plugins_ordering_customer_session (expires_at) WHERE revoked_at IS NULL`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_customer_otp_challenge_uq
       ON plugins_ordering_customer_otp (challenge_id)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_customer_otp_target_idx
       ON plugins_ordering_customer_otp (target_hash, created_at)`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_cart_token_uq
       ON plugins_ordering_cart (token_hash) WHERE token_hash IS NOT NULL`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_cart_activity_idx
       ON plugins_ordering_cart (status, last_activity_at)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_data_request_status_idx
       ON plugins_ordering_data_request (status, requested_at)`,
    );

    // --- link-table columns (Strapi may or may not add an `_ord` column) --------------
    const linkColumns = new Set(
      await trx('information_schema.columns')
        .where({ table_name: LINK })
        .pluck('column_name'),
    );
    const hasOrd = linkColumns.has('customer_ord');

    // --- backfill customers from order.contactSnapshot.phone, 500 orders per batch ----
    const hash = o11Hashing(
      (strapi.config.get('plugin::ordering') as { encryptionKey?: string } | undefined)
        ?.encryptionKey,
    );
    const phonesById = new Map<string, number>();

    const upsertCustomer = async (phone: string): Promise<number> => {
      const cached = phonesById.get(phone);
      if (cached !== undefined) return cached;
      const phoneHash = hash.phoneHash(phone);
      await trx.raw(
        `INSERT INTO ${CUSTOMER} (document_id, phone, phone_hash, status, order_count, total_spent, created_at, updated_at)
         VALUES (?, ?, ?, 'unverified', 0, 0, now(), now())
         ON CONFLICT DO NOTHING`,
        [newDocumentId(), phone, phoneHash],
      );
      const row = await trx(CUSTOMER).select('id').where({ phone_hash: phoneHash }).first();
      phonesById.set(phone, row.id as number);
      return row.id as number;
    };

    let lastId = 0;
    for (;;) {
      const { rows } = await trx.raw(
        `SELECT o.id, o.contact_snapshot->>'phone' AS phone
         FROM ${ORDER} o
         WHERE o.id > ?
           AND o.contact_snapshot->>'phone' IS NOT NULL
           AND o.contact_snapshot->>'phone' <> ''
         ORDER BY o.id LIMIT ?`,
        [lastId, BATCH],
      );
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1].id as number;

      const rawPhones = new Set(rows.map((r: { id: number; phone: string }) => r.phone));
      for (const rawPhone of rawPhones) {
        const normalized = normalizeVietnamesePhone(rawPhone);
        const phone: string = normalized.valid ? normalized.e164 : String(rawPhone);
        const customerId = await upsertCustomer(phone);
        const ord = hasOrd ? ', 1' : '';
        await trx.raw(
          `INSERT INTO ${LINK} (order_id, customer_id${hasOrd ? ', customer_ord' : ''})
           SELECT o.id, ?${ord} FROM ${ORDER} o
           WHERE o.contact_snapshot->>'phone' = ?
           ON CONFLICT DO NOTHING`,
          [customerId, rawPhone],
        );
      }
    }

    // --- stats: completed orders only ------------------------------------------------
    await trx.raw(
      `UPDATE ${CUSTOMER} c SET
         order_count = s.n,
         total_spent = s.total,
         last_order_at = s.last_at
       FROM (
         SELECT l.customer_id,
                COUNT(*) AS n,
                COALESCE(SUM(o.total_amount), 0)::bigint AS total,
                MAX(o.placed_at) AS last_at
         FROM ${LINK} l
         JOIN ${ORDER} o ON o.id = l.order_id
         WHERE o.status = 'completed'
         GROUP BY l.customer_id
       ) s
       WHERE c.id = s.customer_id`,
    );
  },
};
