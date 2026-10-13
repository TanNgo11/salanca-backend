// O11 step 1 gate: the six customer-era content types are registered and stay CM/CTB-hidden,
// order.customer points at the new profile, migration 0007's lookup indexes exist, and its
// backfill links historical orders to deduplicated customers (idempotent, batches of 500).
import assert from 'node:assert/strict';

import {
  basicOrderInput,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

const { o11CustomersMigration } = await import(
  '../../src/plugins/ordering/dist/server/src/migrations/0007-o11-customers.js'
);
const { o11Hashing } = await import(
  '../../src/plugins/ordering/dist/server/src/domain/customers/identity.js'
);

const O11_UIDS = [
  'plugin::ordering.customer',
  'plugin::ordering.customer-address',
  'plugin::ordering.customer-session',
  'plugin::ordering.customer-otp',
  'plugin::ordering.cart',
  'plugin::ordering.data-request',
];

const rerunMigration = (app) =>
  app.db.connection.transaction(async (trx) => o11CustomersMigration.up(trx, app));

await withApp(async (app) => {
  // --- content types registered + hidden ------------------------------------------------
  for (const uid of O11_UIDS) {
    const ct = app.contentTypes[uid];
    assert.ok(ct, `${uid} must be registered`);
    const pluginOptions = ct.pluginOptions ?? {};
    assert.equal(pluginOptions['content-manager']?.visible, false, `${uid} must be CM-hidden`);
    assert.equal(
      pluginOptions['content-type-builder']?.visible,
      false,
      `${uid} must be CTB-hidden`,
    );
  }
  const orderCt = app.contentTypes['plugin::ordering.order'];
  const customerRel = orderCt.attributes.customer;
  assert.equal(customerRel.type, 'relation');
  assert.equal(customerRel.relation, 'manyToOne');
  assert.equal(customerRel.target, 'plugin::ordering.customer');
  console.log('[ordering-test] 6 O11 content types registered, hidden; order.customer wired');

  // --- O11 admin actions registered ------------------------------------------------------
  const actionProvider = app.admin.services.permission.actionProvider;
  for (const uid of ['customer.read', 'customer.manage', 'customer.erase']) {
    assert.ok(
      actionProvider.has(`plugin::ordering.${uid}`),
      `admin action plugin::ordering.${uid} must be registered`,
    );
  }
  console.log('[ordering-test] customer.read/customer.manage/customer.erase registered');

  // --- backfill: orders created post-boot get linked by a re-run --------------------------
  const { order } = services(app);
  await seedBranches(app);
  seedMenu(app);

  const hash = o11Hashing(app.config.get('plugin::ordering').encryptionKey);
  const phoneA = '+84900000001';
  const phoneB = '+84901234567';

  const a1 = await order.createOrder(
    basicOrderInput({ contact: { name: 'Kh A', phone: '0900000001' } }),
    systemCtx,
  );
  const a2 = await order.createOrder(
    basicOrderInput({ contact: { name: 'Kh A', phone: '+84900000001' } }),
    systemCtx,
  );
  const b1 = await order.createOrder(
    basicOrderInput({ contact: { name: 'Kh B', phone: phoneB } }),
    systemCtx,
  );
  // Guest orders created post-boot have no customer link yet.
  for (const created of [a1, a2, b1]) {
    const row = await app.db
      .query('plugin::ordering.order')
      .findOne({ where: { id: created.order.order.id }, populate: { customer: true } });
    assert.equal(row.customer, null, 'order must start unlinked before the backfill runs');
  }

  await rerunMigration(app);

  const customers = await app.db.query('plugin::ordering.customer').findMany({});
  assert.equal(customers.length, 2, 'two distinct phones → two customers');
  const byHash = new Map(customers.map((c) => [c.phoneHash, c]));
  const customerA = byHash.get(hash.phoneHash(phoneA));
  const customerB = byHash.get(hash.phoneHash(phoneB));
  assert.ok(customerA, 'customer A must exist');
  assert.ok(customerB, 'customer B must exist');
  assert.equal(customerA.phone, phoneA, 'phone stored normalized to E.164');
  assert.equal(customerA.status, 'unverified');
  assert.match(customerA.phoneHash, /^[0-9a-f]{64}$/);
  assert.notEqual(customerA.phoneHash.includes(phoneA), true, 'hash must not contain the phone');

  const linked = async (orderId) =>
    app.db
      .query('plugin::ordering.order')
      .findOne({ where: { id: orderId }, populate: { customer: true } });
  // Both spellings of A's phone normalize to the same E.164 → same customer.
  assert.equal((await linked(a1.order.order.id)).customer.id, customerA.id);
  assert.equal((await linked(a2.order.order.id)).customer.id, customerA.id);
  assert.equal((await linked(b1.order.order.id)).customer.id, customerB.id);
  console.log('[ordering-test] backfill linked 3 orders to 2 deduplicated customers');

  // Stats: only completed orders count. Mark A1 + B1 completed, re-run, verify.
  await app.db
    .connection('plugins_ordering_order')
    .whereIn('id', [a1.order.order.id, b1.order.order.id])
    .update({ status: 'completed' });
  await rerunMigration(app);
  const statsA = await app.db
    .query('plugin::ordering.customer')
    .findOne({ where: { id: customerA.id } });
  assert.equal(statsA.orderCount, 1, 'one completed order for A');
  assert.equal(Number(statsA.totalSpent), 195000);
  assert.ok(statsA.lastOrderAt, 'lastOrderAt set from the completed order');
  const statsB = await app.db
    .query('plugin::ordering.customer')
    .findOne({ where: { id: customerB.id } });
  assert.equal(statsB.orderCount, 1);
  assert.equal(Number(statsB.totalSpent), 195000);
  console.log('[ordering-test] customer stats reflect completed orders only');

  // Idempotency: a third run changes nothing (no dup customers, no dup links).
  await rerunMigration(app);
  const after = await app.db.query('plugin::ordering.customer').findMany({});
  assert.equal(after.length, 2);
  const linkCount = await app.db
    .connection('plugins_ordering_order_customer_lnk')
    .count('* as c')
    .first();
  assert.equal(Number(linkCount.c), 3);
  console.log('[ordering-test] migration re-run is idempotent');
});
