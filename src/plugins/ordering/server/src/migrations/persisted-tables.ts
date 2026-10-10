import type { Core } from '@strapi/strapi';

import { MIGRATIONS_TABLE } from './runner';

type PersistedTableEntry = string | { name: string; dependsOn?: Array<{ name: string }> };

/**
 * Reserves every `plugins_ordering_*` table in the core-store `persisted_tables` key.
 * Strapi's schema sync drops tables that were in the *previous stored schema* but are not in
 * the current one — i.e. booting with the plugin disabled would drop every ordering table
 * (and its migration indexes). Entries already in the store (strings or
 * `{ name, dependsOn }` objects, e.g. EE audit tables) are kept untouched; ordering tables
 * are appended as plain strings. Returns the ordering table names it ADDED (empty when the
 * store already covered everything).
 *
 * NOTE: the write takes effect from the NEXT schema sync — the current boot's diff already
 * ran. That is fine: the first enabled boot only needs to create the tables.
 */
export const persistOrderingTables = async (strapi: Core.Strapi): Promise<string[]> => {
  const names = new Set<string>([MIGRATIONS_TABLE]);
  for (const [uid, metadata] of strapi.db.metadata) {
    if (!uid.startsWith('plugin::ordering.')) continue;
    const model = metadata as {
      tableName?: string;
      attributes?: Record<string, { joinTable?: { name?: string } }>;
    };
    if (model.tableName) names.add(model.tableName);
    for (const attribute of Object.values(model.attributes ?? {})) {
      if (attribute.joinTable?.name) names.add(attribute.joinTable.name);
    }
  }

  const current =
    (await strapi.store.get({
      type: 'core',
      key: 'persisted_tables',
    })) ?? [];
  const existing = new Set(
    (current as PersistedTableEntry[]).map((entry) =>
      typeof entry === 'string' ? entry : entry.name,
    ),
  );
  const missing = [...names].filter((name) => !existing.has(name));
  if (missing.length > 0) {
    await strapi.store.set({
      type: 'core',
      key: 'persisted_tables',
      value: [...(current as PersistedTableEntry[]), ...missing],
    });
  }
  return missing;
};
