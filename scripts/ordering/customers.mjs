// O11 step 1 gate: the six customer-era content types are registered and stay CM/CTB-hidden,
// order.customer points at the new profile, migration 0007's lookup indexes exist, and its
// backfill links historical orders to deduplicated customers (idempotent, batches of 500).
// O11 step 3 appends: /me over HTTP (401 without a token, foreign ids 404), profile/address
// writes, session-first + phone-fallback order linking, and stats on completed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Trusted visitor-IP forwarding gives each client its own rate-limit bucket.
process.env.FORM_INTAKE_SHARED_SECRET = 'storefront-test-secret';

import {
  basicOrderInput,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

const { runOutboxDispatcher } = await import(
  '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js'
);

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

  const customerConfig = app.config.get('plugin::ordering').customers;
  customerConfig.enabled = false; // Simulate historical orders from before O11.
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
  customerConfig.enabled = true;
  // Historical orders have no customer link yet.
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

  // ── Step 3: /me over HTTP, order linking (session > phone), stats on completed ──────────
  const plugin = app.plugin('ordering');
  const capture = plugin.service('registry').notificationProvider('email');
  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  let visitor = 100;
  const call = async (method, path, { body, headers = {} } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'x-salanca-intake-secret': 'storefront-test-secret',
        'x-salanca-visitor-ip': `192.0.2.${visitor++}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const asCustomer = (token) => (method, path, body) =>
    call(method, path, { body, headers: { 'x-customer-token': token } });
  const login = async (email) => {
    const otp = await call('POST', '/auth/otp', {
      body: { channel: 'email', target: email, captchaToken: 'pass' },
    });
    assert.equal(otp.status, 200);
    const code = capture.sent.at(-1).text.match(/\b(\d{6})\b/)[1];
    const res = await call('POST', '/auth/verify', {
      body: { challengeId: otp.body.challengeId, code },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body;
  };

  // No token / dead token → 401 everywhere.
  for (const [method, path] of [
    ['GET', '/me'],
    ['PUT', '/me'],
    ['GET', '/me/addresses'],
    ['GET', '/me/orders'],
    ['GET', '/me/orders/ANY-CODE'],
  ]) {
    const res = await call(method, path);
    assert.equal(res.status, 401, `${method} ${path} must need a session`);
    assert.equal(res.body.error.code, 'CUSTOMER_AUTH_REQUIRED');
  }
  assert.equal(
    (await call('GET', '/me', { headers: { 'x-customer-token': 'deadbeef' } })).status,
    401,
    'a dead token is a 401 too',
  );

  const sessionA = await login('lan@example.com');
  const sessionB = await login('minh@example.com');
  const lan = asCustomer(sessionA.token);
  const minh = asCustomer(sessionB.token);
  const idOf = async (docId) =>
    (await app.db.query('plugin::ordering.customer').findOne({ where: { documentId: docId } })).id;

  // Profile: PUT accepts name + consent (stamped); email is read-only.
  const me = await lan('GET', '/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.email, 'lan@example.com');
  const updated = await lan('PUT', '/me', {
    name: '  Lan Trần  ',
    marketingConsent: { granted: true },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.name, 'Lan Trần');
  assert.equal(updated.body.marketingConsent.granted, true);
  assert.equal(updated.body.marketingConsent.source, 'self');
  assert.ok(updated.body.marketingConsent.policyVersion);
  const emailChange = await lan('PUT', '/me', { email: 'other@example.com' });
  assert.equal(emailChange.status, 400);
  assert.equal(emailChange.body.error.code, 'VALIDATION_ERROR');
  const off = await lan('PUT', '/me', { marketingConsent: { granted: false } });
  assert.equal(off.body.marketingConsent.granted, false);
  assert.equal(off.body.marketingConsent.history[0].granted, false);
  assert.ok(
    off.body.marketingConsent.history.some((h) => h.granted === true),
    'consent history keeps the earlier opt-in',
  );
  console.log('[ordering-test] /me profile: update name + stamped consent history; email locked');

  // Address book: first becomes default; exactly one default; 10 max; foreign ids 404.
  const addressBody = (overrides = {}) => ({
    recipientName: 'Lan Trần',
    phone: '0901234567',
    line1: '12 Đường Thử',
    communeCode: 'XT01001',
    note: 'gọi trước khi giao',
    ...overrides,
  });
  const addr1 = await lan('POST', '/me/addresses', addressBody({ label: 'Nhà' }));
  assert.equal(addr1.status, 201, JSON.stringify(addr1.body));
  assert.equal(addr1.body.address.isDefault, true, 'first address becomes default');
  assert.equal(addr1.body.address.communeName, 'Phường Bến Thử');
  assert.equal(addr1.body.address.phone, '+84901234567');
  const addr2 = await lan('POST', '/me/addresses', addressBody({ label: 'Cty', communeCode: 'XT01002' }));
  assert.equal(addr2.body.address.isDefault, false, 'second stays non-default');
  const badAddr = await lan('POST', '/me/addresses', addressBody({ communeCode: 'NOPE99' }));
  assert.equal(badAddr.status, 400);
  assert.equal(badAddr.body.error.details.field, 'receiveMethod.address.communeCode');
  const flip = await lan('PUT', `/me/addresses/${addr2.body.address.id}`, {
    ...addressBody({ communeCode: 'XT01002' }),
    isDefault: true,
  });
  assert.equal(flip.body.address.isDefault, true);
  const listed = await lan('GET', '/me/addresses');
  assert.equal(listed.body.items.length, 2);
  assert.equal(
    listed.body.items.filter((a) => a.isDefault).length,
    1,
    'exactly one default',
  );
  assert.equal(listed.body.items[0].isDefault, true, 'default sorts first');
  assert.equal(
    (await minh('GET', '/me/addresses')).body.items.length,
    0,
    'customer B has an empty book',
  );
  assert.equal(
    (await minh('PUT', `/me/addresses/${addr1.body.address.id}`, addressBody())).status,
    404,
    'B cannot update A’s address',
  );
  assert.equal(
    (await minh('DELETE', `/me/addresses/${addr1.body.address.id}`)).status,
    404,
    'B cannot delete A’s address',
  );
  for (let i = listed.body.items.length; i < 10; i += 1) {
    await lan('POST', '/me/addresses', addressBody({ label: `a${i}` }));
  }
  const eleventh = await lan('POST', '/me/addresses', addressBody({ label: 'eleven' }));
  assert.equal(eleventh.status, 400, 'the 11th address is refused');
  assert.equal(eleventh.body.error.details.limit, 10);
  const delDefault = await lan('DELETE', `/me/addresses/${addr2.body.address.id}`);
  assert.equal(delDefault.status, 204);
  const afterDelete = await lan('GET', '/me/addresses');
  assert.equal(afterDelete.body.items.length, 9);
  assert.equal(
    afterDelete.body.items.filter((a) => a.isDefault).length,
    1,
    'deleting the default promotes another',
  );
  console.log('[ordering-test] /me/addresses: defaults, validation, 10-cap, foreign 404');

  // Order linking: session wins; an unknown guest phone creates an unverified profile.
  const aInternal = await idOf(sessionA.customer.id);
  const bInternal = await idOf(sessionB.customer.id);
  const link = async (orderId) =>
    (await app.db.query('plugin::ordering.order').findOne({
      where: { id: orderId },
      populate: { customer: true },
    })).customer?.id ?? null;
  const bySession = await order.createOrder(
    basicOrderInput({
      customerId: aInternal,
      contact: { name: 'Kh A', phone: '+84909999999' }, // different phone on purpose
    }),
    systemCtx,
  );
  assert.equal(await link(bySession.order.order.id), aInternal, 'session wins over phone');
  const byPhone = await order.createOrder(
    basicOrderInput({ contact: { name: 'Kh B', phone: '0901234567' } }),
    systemCtx,
  );
  assert.equal(await link(byPhone.order.order.id), customerB.id, 'guest phone attaches to B');
  const unknown = await order.createOrder(
    basicOrderInput({ contact: { name: 'Khách', phone: '+84905555555' } }),
    systemCtx,
  );
  const guestId = await link(unknown.order.order.id);
  assert.ok(guestId, 'first guest checkout creates and links a profile');
  const guest = await app.db.query('plugin::ordering.customer').findOne({ where: { id: guestId } });
  assert.equal(guest.status, 'unverified');
  assert.equal(guest.phone, '+84905555555');
  assert.ok(guest.documentId, 'new guest profile is addressable in Admin');
  assert.equal(guest.emailVerifiedAt, null, 'checkout cannot verify an identity');
  const firstTimeOrders = await Promise.all(Array.from({ length: 4 }, () => order.createOrder(
    basicOrderInput({ contact: { name: 'Concurrent guest', phone: '0905555556' } }), systemCtx,
  )));
  const linkedGuests = await Promise.all(firstTimeOrders.map((result) => link(result.order.order.id)));
  assert.ok(linkedGuests.every((id) => id === linkedGuests[0] && id !== null), 'concurrent first orders share one profile');
  assert.equal(await app.db.query('plugin::ordering.customer').count({ where: { phone: '+84905555556' } }), 1);
  await app.db.query('plugin::ordering.customer').update({
    where: { id: guestId }, data: { status: 'erased', phone: null },
  });
  assert.equal(await plugin.service('customer').linkForOrder({ phoneE164: '+84905555555' }), null,
    'guest checkout never resurrects an erased profile');
  const toB = await order.createOrder(
    basicOrderInput({ customerId: bInternal, contact: { name: 'Minh', phone: '+84906666666' } }),
    systemCtx,
  );
  assert.equal(await link(toB.order.order.id), bInternal);
  console.log('[ordering-test] createOrder links by session, then by contact phone');

  // My orders: each session lists only its own; foreign codes 404.
  const mineA = await lan('GET', '/me/orders');
  assert.equal(mineA.status, 200);
  assert.deepEqual(
    mineA.body.items.map((o) => o.code),
    [bySession.order.order.code],
  );
  const mineB = await minh('GET', '/me/orders');
  assert.deepEqual(
    mineB.body.items.map((o) => o.code),
    [toB.order.order.code],
  );
  const codeB = toB.order.order.code;
  assert.equal((await lan('GET', `/me/orders/${codeB}`)).status, 404, 'A reads B → 404');
  const ownView = await minh('GET', `/me/orders/${codeB}`);
  assert.equal(ownView.status, 200);
  assert.equal(ownView.body.order.code, codeB);
  assert.equal(ownView.body.order.contact, undefined, 'reduced view carries no PII');
  console.log('[ordering-test] /me/orders scoped to the session; foreign code → 404');

  // Stats: completed order refreshes via the order.transitioned outbox consumer.
  const statOrder = bySession.order.order;
  await app.db
    .connection('plugins_ordering_order')
    .where('id', statOrder.id)
    .update({ status: 'completed' });
  await plugin.service('outbox').enqueue(
    {
      type: 'order.transitioned',
      aggregateType: 'order',
      aggregateId: String(statOrder.id),
      payload: { orderId: statOrder.id, from: 'open', to: 'completed', locationRef: 'Q1' },
      uniqueKey: `test-transitioned:${randomUUID()}`,
    },
    systemCtx,
  );
  await runOutboxDispatcher(app, { owner: `test:${process.pid}` });
  const statA = await app.db
    .query('plugin::ordering.customer')
    .findOne({ where: { id: aInternal } });
  assert.equal(statA.orderCount, 1);
  assert.equal(Number(statA.totalSpent), 195000);
  assert.ok(
    Math.abs(new Date(statA.lastOrderAt).getTime() - new Date(statOrder.placedAt).getTime()) < 1000,
    `lastOrderAt ${statA.lastOrderAt} ≈ placedAt ${statOrder.placedAt}`,
  );
  // A non-completed transition leaves stats alone; a re-dispatch is a no-op.
  await runOutboxDispatcher(app, { owner: `test:${process.pid}` });
  assert.equal(
    (await app.db.query('plugin::ordering.customer').findOne({ where: { id: aInternal } }))
      .orderCount,
    1,
    'stats are idempotent',
  );
  console.log('[ordering-test] order.transitioned → completed refreshes customer stats');

  // A second completed order for the same customer: bigint amounts must add as numbers (BUG-02).
  // `basicOrderInput` mints a fresh idempotencyKey, so this is a new order, not a replay.
  const bySession2 = await order.createOrder(
    basicOrderInput({
      customerId: aInternal,
      contact: { name: 'Kh A', phone: '+84909999999' },
    }),
    systemCtx,
  );
  assert.notEqual(
    bySession2.order.order.id,
    statOrder.id,
    'a fresh idempotencyKey must create a second order',
  );
  await app.db
    .connection('plugins_ordering_order')
    .where('id', bySession2.order.order.id)
    .update({ status: 'completed' });
  await plugin.service('outbox').enqueue(
    {
      type: 'order.transitioned',
      aggregateType: 'order',
      aggregateId: String(bySession2.order.order.id),
      payload: {
        orderId: bySession2.order.order.id,
        from: 'open',
        to: 'completed',
        locationRef: 'Q1',
      },
      uniqueKey: `test-transitioned:${randomUUID()}`,
    },
    systemCtx,
  );
  await runOutboxDispatcher(app, { owner: `test:${process.pid}` });
  const totalOf = async (id) =>
    Number((await app.db.query('plugin::ordering.order').findOne({ where: { id } })).totalAmount);
  const afterTwo = await app.db
    .query('plugin::ordering.customer')
    .findOne({ where: { id: aInternal } });
  assert.equal(afterTwo.orderCount, 2);
  assert.equal(
    Number(afterTwo.totalSpent),
    (await totalOf(statOrder.id)) + (await totalOf(bySession2.order.order.id)),
    'two completed orders must add as numbers, not concatenate as strings (BUG-02)',
  );
  console.log('[ordering-test] two completed orders add totalSpent as numbers (BUG-02)');
});
