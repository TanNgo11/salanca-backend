import { AUDIT_ACTIONS } from '../domain/audit/actions';
import type { OrderingMigration } from './runner';

/**
 * O15 audit-log indexes and the `category` backfill for rows written before O15. Runs after Strapi
 * schema sync, so the new columns already exist. `entity_label` stays null on old rows.
 */
export const o15AuditLogMigration: OrderingMigration = {
  name: '0005-o15-audit-log',
  async up(trx) {
    const table = 'plugins_ordering_admin_change_log';
    for (const [column, name] of [
      ['occurred_at desc', 'occurred'],
      ['actor_ref, occurred_at', 'actor'],
      ['category, occurred_at', 'category'],
      ['location_ref, occurred_at', 'location'],
      ['order_id', 'order'],
      ['entity_type, entity_id', 'entity'],
    ] as const) {
      await trx.raw(
        `CREATE INDEX IF NOT EXISTS plugins_ordering_change_log_${name}_idx ON ${table} (${column})`,
      );
    }
    await trx.raw(
      `CREATE INDEX IF NOT EXISTS plugins_ordering_change_log_unhashed_idx ON ${table} (id) WHERE hash IS NULL`,
    );
    const byCategory = new Map<string, string[]>();
    for (const [action, def] of Object.entries(AUDIT_ACTIONS)) {
      byCategory.set(def.category, [...(byCategory.get(def.category) ?? []), action]);
    }
    for (const [category, actions] of byCategory) {
      await trx(table).whereNull('category').whereIn('action', actions).update({ category });
    }
    await trx(table).whereNull('category').update({ category: 'other' });
  },
};
