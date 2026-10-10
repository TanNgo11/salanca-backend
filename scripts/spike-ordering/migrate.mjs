import assert from 'node:assert/strict';
import { loadSpikeApp } from './runtime.mjs';

const app = await loadSpikeApp();
const table = 'plugins_ordering_migration_probe';
try {
  await app.db.connection.schema.dropTableIfExists(table);
  await app.db.connection.schema.createTable(table, (t) => { t.increments('id'); t.string('legacy_value'); });
  const migrate = () => app.db.transaction(async ({ trx }) => {
    await trx.raw("SELECT pg_advisory_xact_lock(hashtext('ordering-o0-migration'))");
    const hasColumn = await trx.schema.hasColumn(table, 'new_value');
    if (!hasColumn) await trx.schema.alterTable(table, (t) => t.string('new_value').nullable());
  });
  await Promise.all([migrate(), migrate()]);
  assert.equal(await app.db.connection.schema.hasColumn(table, 'new_value'), true);
  await app.db.connection(table).insert({ legacy_value: 'preserved' });
  assert.equal((await app.db.connection(table).first()).legacy_value, 'preserved');
  console.log('[spike] migration probe: idempotent under two concurrent runners; legacy row preserved');
} finally { await app.db.connection.schema.dropTableIfExists(table); await app.destroy(); }
