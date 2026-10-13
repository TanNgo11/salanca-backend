import type { OrderingMigration } from './runner';

/**
 * O10 indexes Strapi cannot express: one delivery row per (endpoint, outbox event) so the fanout
 * is idempotent, the dispatcher's pending scan, and one custom email template per (code, locale).
 * Runs after Strapi schema sync, so the new tables already exist here.
 */
export const o10ExtensibilityMigration: OrderingMigration = {
  name: '0006-o10-extensibility',
  async up(trx) {
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_webhook_delivery_uq
       ON plugins_ordering_webhook_delivery (endpoint_id, event_id)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_webhook_delivery_pending_idx
       ON plugins_ordering_webhook_delivery (status, next_attempt_at)`,
    );
    await trx.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS plugins_ordering_notification_template_uq
       ON plugins_ordering_notification_template (code, message_locale)`,
    );
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_catalog_import_created_idx
       ON plugins_ordering_catalog_import (created_at DESC)`,
    );
  },
};
