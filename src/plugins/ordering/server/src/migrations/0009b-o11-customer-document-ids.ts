import { newDocumentId } from './document-id';
import type { OrderingMigration } from './runner';

/**
 * 0007 backfilled customers from order phones with raw SQL and no document_id, so those
 * profiles listed in Admin but could not be opened (the API addresses customers by
 * documentId). Give every customer without one a fresh id. Idempotent: only NULL rows.
 */
export const o11CustomerDocumentIdsMigration: OrderingMigration = {
  name: '0009b-o11-customer-document-ids',
  async up(trx) {
    for (;;) {
      const rows = (await trx('plugins_ordering_customer')
        .whereNull('document_id')
        .orderBy('id')
        .limit(500)
        .select('id')) as Array<{ id: number }>;
      if (rows.length === 0) break;
      for (const row of rows) {
        await trx('plugins_ordering_customer').where({ id: row.id }).update({ document_id: newDocumentId() });
      }
    }
  },
};
