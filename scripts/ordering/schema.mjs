// O1+O2 schema check: tables, link tables, migration indexes, sequence, migration ledger rows,
// Content Manager/CTB visibility and the absence of generated REST routes.
import assert from 'node:assert/strict';

import { withApp } from './_harness.mjs';

const EXPECTED_TABLES = [
  'plugins_ordering_adjustment_allocation',
  'plugins_ordering_admin_change_log',
  'plugins_ordering_branch',
  'plugins_ordering_catalog_availability_window',
  'plugins_ordering_catalog_category',
  'plugins_ordering_catalog_location_state',
  'plugins_ordering_catalog_modifier',
  'plugins_ordering_catalog_modifier_group',
  'plugins_ordering_catalog_price',
  'plugins_ordering_catalog_product',
  'plugins_ordering_catalog_slug',
  'plugins_ordering_catalog_variant',
  'plugins_ordering_fulfillment',
  'plugins_ordering_fulfillment_group',
  'plugins_ordering_fulfillment_line',
  'plugins_ordering_hold',
  'plugins_ordering_idempotency_key',
  'plugins_ordering_ops_alert',
  'plugins_ordering_order',
  'plugins_ordering_order_adjustment',
  'plugins_ordering_order_event',
  'plugins_ordering_order_job_lock',
  'plugins_ordering_order_line',
  'plugins_ordering_outbox',
  'plugins_ordering_payment',
  'plugins_ordering_payment_event',
  'plugins_ordering_refund',
  'plugins_ordering_refund_line',
  'plugins_ordering_staff_location_scope',
];

const EXPECTED_INDEXES = [
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
  'plugins_ordering_catalog_slug_locale_uq',
  'plugins_ordering_catalog_slug_entity_idx',
  'plugins_ordering_catalog_location_state_uq',
  'plugins_ordering_catalog_variant_sku_uq',
  'plugins_ordering_catalog_product_online_idx',
];

// Catalog types staff edit in Content Manager (O2 step 1).
const CM_VISIBLE_UIDS = [
  'plugin::ordering.catalog-category',
  'plugin::ordering.catalog-product',
  'plugin::ordering.catalog-variant',
  'plugin::ordering.catalog-price',
  'plugin::ordering.catalog-modifier-group',
  'plugin::ordering.catalog-modifier',
  'plugin::ordering.catalog-availability-window',
];

// catalog-slug and catalog-location-state stay hidden: service-owned rows only.
const CM_HIDDEN_CATALOG_UIDS = [
  'plugin::ordering.catalog-slug',
  'plugin::ordering.catalog-location-state',
];

// Every manyToOne owner side produces one link table (28 relations across the 29 types).
const MIN_LINK_TABLES = 28;

await withApp(async (app) => {
  const { rows: tables } = await app.db.connection.raw(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  const tableNames = tables.map((row) => row.table_name);
  const orderingTables = tableNames.filter((name) => name.startsWith('plugins_ordering_'));
  for (const expected of EXPECTED_TABLES) {
    assert.ok(orderingTables.includes(expected), `missing table ${expected}`);
  }
  assert.ok(orderingTables.includes('plugins_ordering_migrations'), 'missing migrations ledger');
  console.log(`[ordering-test] ${EXPECTED_TABLES.length} expected tables exist`);

  const linkTables = orderingTables.filter((name) => name.endsWith('_lnk'));
  console.log(`[ordering-test] link tables (${linkTables.length}): ${linkTables.join(', ')}`);
  assert.ok(
    linkTables.length >= MIN_LINK_TABLES,
    `expected at least ${MIN_LINK_TABLES} link tables, got ${linkTables.length}`,
  );

  const { rows: indexes } = await app.db.connection.raw(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
     AND indexname LIKE 'plugins_ordering_%' ORDER BY indexname`,
  );
  const indexNames = indexes.map((row) => row.indexname);
  for (const expected of EXPECTED_INDEXES) {
    assert.ok(indexNames.includes(expected), `missing index ${expected}`);
  }
  const uniqueIndexes = indexes.filter((row) => row.indexdef.includes('UNIQUE'));
  console.log(
    `[ordering-test] ${EXPECTED_INDEXES.length} migration indexes exist; ` +
      `unique indexes: ${uniqueIndexes.map((row) => row.indexname).join(', ')}`,
  );

  const { rows: sequences } = await app.db.connection.raw(
    `SELECT relname FROM pg_class WHERE relkind = 'S' AND relname LIKE 'plugins_ordering_%'`,
  );
  assert.ok(
    sequences.some((row) => row.relname === 'plugins_ordering_order_code_seq'),
    'missing plugins_ordering_order_code_seq sequence',
  );

  const applied = await app.db
    .connection('plugins_ordering_migrations')
    .select('name')
    .orderBy('name');
  for (const migration of ['0001-o1-core', '0002-o2-catalog']) {
    assert.ok(
      applied.some((row) => row.name === migration),
      `migration ${migration} is not recorded`,
    );
  }
  console.log('[ordering-test] sequence exists; migration ledger:', applied.map((row) => row.name).join(', '));

  const orderingUids = Object.keys(app.contentTypes).filter((uid) =>
    uid.startsWith('plugin::ordering.'),
  );
  assert.equal(orderingUids.length, EXPECTED_TABLES.length, 'expected 29 plugin content types');
  for (const uid of orderingUids) {
    const contentType = app.contentTypes[uid];
    const pluginOptions = contentType.pluginOptions ?? contentType.schema?.pluginOptions ?? {};
    const expectVisible = CM_VISIBLE_UIDS.includes(uid);
    assert.equal(
      pluginOptions['content-manager']?.visible,
      expectVisible,
      `${uid} Content Manager visibility must be ${expectVisible}`,
    );
    assert.equal(
      pluginOptions['content-type-builder']?.visible,
      false,
      `${uid} must be hidden from Content-Type Builder`,
    );
    // No catalog type may be localized or Draft & Publish (contracts §20.1).
    if (uid.startsWith('plugin::ordering.catalog-')) {
      assert.equal(
        pluginOptions.i18n?.localized ?? false,
        false,
        `${uid} must not be localized`,
      );
      assert.equal(
        contentType.options?.draftAndPublish ?? contentType.schema?.options?.draftAndPublish,
        false,
        `${uid} must not use Draft & Publish`,
      );
    }
  }
  for (const uid of CM_HIDDEN_CATALOG_UIDS) {
    assert.ok(orderingUids.includes(uid), `${uid} must exist and stay CM-hidden`);
  }
  console.log(
    `[ordering-test] ${orderingUids.length} content types: ${CM_VISIBLE_UIDS.length} CM-visible catalog, ` +
      `rest CM-hidden; all CTB-hidden, none localized/D&P`,
  );

  assert.ok(
    typeof app.server.listRoutes === 'function',
    'app.server.listRoutes() must exist for the route check',
  );
  // Allowlist: the only ordering routes the plugin may ever expose (O2 steps 7/7b/8).
  // Public catalog API is read-only; everything else lives under the authenticated Admin API.
  const orderingRoutes = app.server
    .listRoutes()
    .filter((route) => String(route.path).includes('ordering'))
    .map((route) => ({
      methods: route.methods ?? [],
      path: String(route.path),
    }));
  for (const route of orderingRoutes) {
    const label = `${route.methods.join(',')} ${route.path}`;
    const allowed =
      route.path.startsWith('/admin/ordering/') ||
      (route.path.startsWith('/api/v1/ordering/catalog/') &&
        route.methods.every((method) => method === 'GET'));
    assert.ok(allowed, `unexpected ordering route: ${label}`);
  }
  console.log(`[ordering-test] plugin routes within allowlist (${orderingRoutes.length} registered)`);
});
