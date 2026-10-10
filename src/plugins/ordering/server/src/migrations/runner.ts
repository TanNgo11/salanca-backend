import type { Core } from '@strapi/strapi';

/**
 * Plugin data migrations. Strapi creates and alters plugin tables from the content-type schemas;
 * this runner only covers what schema sync cannot: backfills, constraints, sequences, indexes.
 * Forward-only. Every run takes one transaction-scoped advisory lock, so concurrent instances
 * apply each migration exactly once.
 */
export type OrderingMigration = {
  name: string;
  up: (trx: TransactionClient) => Promise<void>;
};

// Knex transaction, kept loose so the plugin does not depend on knex types directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TransactionClient = any;

export const MIGRATIONS_TABLE = 'plugins_ordering_migrations';
const LOCK_KEY = 'plugins_ordering_migrations';

export const runOrderingMigrations = async (strapi: Core.Strapi, migrations: OrderingMigration[]) => {
  const connection = strapi.db.connection;
  if (!(await connection.schema.hasTable(MIGRATIONS_TABLE))) {
    await connection.schema.createTable(MIGRATIONS_TABLE, (table: TransactionClient) => {
      table.string('name').primary();
      table.timestamp('applied_at', { useTz: true }).notNullable().defaultTo(connection.fn.now());
    }).catch(async (error: unknown) => {
      // Another instance created it first.
      if (!(await connection.schema.hasTable(MIGRATIONS_TABLE))) throw error;
    });
  }

  const applied: string[] = [];
  await connection.transaction(async (trx: TransactionClient) => {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [LOCK_KEY]);
    const done = new Set(
      (await trx(MIGRATIONS_TABLE).select('name')).map((row: { name: string }) => row.name),
    );
    for (const migration of migrations) {
      if (done.has(migration.name)) continue;
      await migration.up(trx);
      await trx(MIGRATIONS_TABLE).insert({ name: migration.name });
      applied.push(migration.name);
    }
  });
  return applied;
};
