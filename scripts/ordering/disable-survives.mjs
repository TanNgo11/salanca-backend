// Regression for the phase-3 gate finding: Strapi's schema sync drops tables that were in
// the previous stored schema but not the current one. Booting with ORDERING_ENABLED=false
// used to drop every plugins_ordering_* table (and their migration indexes). bootstrap.ts
// reserves them via the core-store `persisted_tables` key — this script proves a disabled
// boot leaves tables, rows and indexes untouched, and that re-enabling keeps working.
import assert from 'node:assert/strict';

import {
  basicOrderInput,
  bootOrderingTestApp,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

const MIGRATION_INDEXES = [
  'plugins_ordering_payment_event_provider_txn_uq',
  'plugins_ordering_idempotency_key_scope_key_uq',
  'plugins_ordering_order_job_lock_job_shard_uq',
  'plugins_ordering_ops_alert_open_dedupe_uq',
  'plugins_ordering_order_code_uq',
  'plugins_ordering_order_public_token_hash_uq',
  'plugins_ordering_branch_code_uq',
  'plugins_ordering_staff_scope_admin_user_uq',
  'plugins_ordering_outbox_unique_key_uq',
  'plugins_ordering_order_location_business_idx',
  'plugins_ordering_order_status_idx',
  'plugins_ordering_outbox_pending_available_idx',
  'plugins_ordering_hold_open_expires_idx',
  'plugins_ordering_order_event_occurred_idx',
];

const assertIndexes = async (db, label) => {
  const { rows } = await db.connection.raw(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
       AND indexname LIKE 'plugins_ordering_%'`,
  );
  const names = rows.map((row) => row.indexname);
  for (const expected of MIGRATION_INDEXES) {
    assert.ok(names.includes(expected), `${label}: missing index ${expected}`);
  }
};

const orderingTableCount = async (db) => {
  const { rows } = await db.connection.raw(
    `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'plugins_ordering_%'`,
  );
  return rows[0].n;
};

const orderRowCount = async (db) => {
  const { rows } = await db.connection.raw(
    'SELECT count(*)::int AS n FROM plugins_ordering_order',
  );
  return rows[0].n;
};

const setOrderCodePrefix = (app) =>
  app.config.set('plugin::ordering.orderCode', {
    template: '{prefix}-{seq:6}',
    prefix: 'SLC',
  });

// (a) Enabled boot: seed + create one order (SLC-000001), record table/index state.
let tableCount = 0;
await withApp(async (app) => {
  const { order } = services(app);
  await seedBranches(app);
  seedMenu(app);
  setOrderCodePrefix(app);
  const created = await order.createOrder(basicOrderInput(), systemCtx);
  assert.equal(created.order.order.code, 'SLC-000001');
  tableCount = await orderingTableCount(app.db);
  assert.ok(tableCount >= 40, `expected ≥40 ordering tables, got ${tableCount}`);
  assert.equal(await orderRowCount(app.db), 1);
  await assertIndexes(app.db, 'before disabled boot');
  console.log(`[ordering-test] baseline: ${tableCount} tables, 1 order, ${MIGRATION_INDEXES.length} indexes`);
});

// (b) Disabled boot (no reset): plugin absent, but every table/row/index must survive.
{
  const app = await bootOrderingTestApp({ enabled: false });
  try {
    let pluginRef;
    try {
      pluginRef = app.plugin('ordering');
    } catch {
      pluginRef = undefined;
    }
    assert.ok(!pluginRef, 'ordering plugin must not be loaded when disabled');
    assert.equal(await orderingTableCount(app.db), tableCount, 'disabled boot dropped tables');
    assert.equal(await orderRowCount(app.db), 1, 'disabled boot dropped order rows');
    await assertIndexes(app.db, 'after disabled boot');
    const persisted =
      (await app.store.get({ type: 'core', key: 'persisted_tables' })) ?? [];
    const persistedNames = persisted.map((entry) =>
      typeof entry === 'string' ? entry : entry.name,
    );
    for (const name of ['plugins_ordering_order', 'plugins_ordering_migrations']) {
      assert.ok(persistedNames.includes(name), `persisted_tables missing ${name}`);
    }
    console.log(
      `[ordering-test] disabled boot: plugin absent, ${tableCount} tables + row + ` +
        `${MIGRATION_INDEXES.length} indexes survived, persisted_tables covers ordering`,
    );
  } finally {
    await app.destroy();
  }
}

// (c) Enabled boot again (no reset): state intact, createOrder still works (SLC-000002).
{
  const app = await bootOrderingTestApp();
  try {
    assert.equal(await orderingTableCount(app.db), tableCount);
    assert.equal(await orderRowCount(app.db), 1);
    await assertIndexes(app.db, 'after re-enabled boot');
    const { order } = services(app);
    seedMenu(app);
    setOrderCodePrefix(app);
    const created = await order.createOrder(basicOrderInput(), systemCtx);
    assert.equal(created.order.order.code, 'SLC-000002');
    console.log('[ordering-test] re-enabled boot: state intact, created SLC-000002');
  } finally {
    await app.destroy();
  }
}
