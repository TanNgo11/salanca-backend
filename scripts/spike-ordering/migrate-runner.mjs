// O0 probe (check 5): the plugin migration runner (server/src/migrations/runner.ts) on a table that
// already holds data: add a nullable column, backfill in batches, then enforce NOT NULL.
// Two runners start concurrently; each migration must be applied exactly once.
import assert from 'node:assert/strict';

import { loadSpikeApp } from './runtime.mjs';

const app = await loadSpikeApp();
const TABLE = 'plugins_ordering_migration_probe';
const NAMES = ['o0-probe-001-add-column', 'o0-probe-002-backfill', 'o0-probe-003-not-null'];
const ROWS = 1000;
try {
  const db = app.db.connection;
  assert.ok(await db.schema.hasTable('plugins_ordering_migrations'), 'bootstrap creates the migrations table');
  await db('plugins_ordering_migrations').whereIn('name', NAMES).del();
  await db.schema.dropTableIfExists(TABLE);
  await db.schema.createTable(TABLE, (t) => { t.increments('id'); t.string('legacy_value').notNullable(); });
  await db.batchInsert(TABLE, Array.from({ length: ROWS }, (_, i) => ({ legacy_value: `legacy-${i}` })), 200);

  let backfillRuns = 0;
  const migrations = [
    { name: NAMES[0], up: (trx) => trx.schema.alterTable(TABLE, (t) => t.string('normalized').nullable()) },
    {
      name: NAMES[1],
      up: async (trx) => {
        backfillRuns += 1;
        for (;;) {
          const batch = await trx(TABLE).whereNull('normalized').select('id').limit(200);
          if (batch.length === 0) break;
          await trx(TABLE).whereIn('id', batch.map((row) => row.id)).update({ normalized: trx.raw('upper(legacy_value)') });
        }
      },
    },
    { name: NAMES[2], up: (trx) => trx.raw(`ALTER TABLE ${TABLE} ALTER COLUMN normalized SET NOT NULL`) },
  ];

  const service = app.plugin('ordering').service('migrations');
  const [first, second] = await Promise.all([service.run(migrations), service.run(migrations)]);
  assert.deepEqual([...first, ...second].sort(), [...NAMES].sort(), 'each migration applied once across both runners');
  assert.equal(backfillRuns, 1);
  assert.deepEqual(await service.run(migrations), [], 'a third run applies nothing');

  const recorded = await db('plugins_ordering_migrations').whereIn('name', NAMES).count({ n: '*' }).first();
  assert.equal(Number(recorded.n), NAMES.length);
  const rows = await db(TABLE).count({ n: '*' }).whereRaw("normalized = upper(legacy_value)").first();
  assert.equal(Number(rows.n), ROWS);
  const column = await db.raw(`SELECT is_nullable FROM information_schema.columns WHERE table_name = ? AND column_name = 'normalized'`, [TABLE]);
  assert.equal(column.rows[0].is_nullable, 'NO');
  console.log(`[spike] migration runner: ${NAMES.length} migrations applied once by two concurrent runners; ${ROWS} legacy rows backfilled in batches; NOT NULL enforced; rerun is a no-op`);
} finally {
  await app.db.connection.schema.dropTableIfExists(TABLE);
  await app.db.connection('plugins_ordering_migrations').whereIn('name', NAMES).del();
  await app.destroy();
}
