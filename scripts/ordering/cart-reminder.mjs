// O11 step 5 gate: POST /me/orders/:code/reorder rebuilds the order's still-sellable lines into
// the customer's cart and reports what can't be re-added; the cart-reminder job mails an idle,
// consented customer exactly once — only when the branch opted in and an email is reachable.
// A failed send retries next run; a sent one never repeats (delivery row + reminderSentAt).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Trusted visitor-IP forwarding gives each client its own rate-limit bucket.
process.env.FORM_INTAKE_SHARED_SECRET = 'storefront-test-secret';

import { seedBranches, seedMenu, withApp } from './_harness.mjs';

const { runCartReminder } = await import(
  '../../src/plugins/ordering/dist/server/src/jobs/cart-reminder.js'
);

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const plugin = app.plugin('ordering');
  const catalog = plugin.service('registry').catalogAdapter('test-catalog');
  const capture = plugin.service('registry').notificationProvider('email');
  const carts = () => app.db.query('plugin::ordering.cart');
  const branches = () => app.db.query('plugin::ordering.branch');
  const deliveries = () => app.db.query('plugin::ordering.notification-delivery');

  const sellable = (overrides) => ({
    requiresShipping: false,
    isVirtual: false,
    isDownloadable: false,
    isGiftCard: false,
    fulfillmentKinds: ['pickup', 'delivery'],
    options: [],
    availability: {},
    categories: [{ ref: 'mon-chinh', title: 'Món chính', path: ['mon-chinh'] }],
    isActive: true,
    purchasable: true,
    ...overrides,
  });

  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  let visitor = 1;
  const call = async (method, path, { body, headers = {} } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'x-salanca-intake-secret': 'storefront-test-secret',
        'x-salanca-visitor-ip': `192.0.6.${visitor++}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const login = async (email) => {
    const otp = await call('POST', '/auth/otp', {
      body: { channel: 'email', target: email, captchaToken: 'pass' },
    });
    assert.equal(otp.status, 200);
    const code = capture.sent.at(-1).text.match(/\b(\d{6})\b/)[1];
    const res = await call('POST', '/auth/verify', {
      body: { challengeId: otp.body.challengeId, code },
    });
    assert.equal(res.status, 200);
    return res.body;
  };
  const reminders = () => capture.sent.filter((mail) => mail.template === 'customer.cart-reminder');

  // ── Reorder: checkout an order, rebuild it into the cart ────────────────────────────
  const session = await login('reorder@example.com');
  const auth = { 'x-customer-token': session.token };
  const customer = await app.db
    .query('plugin::ordering.customer')
    .findOne({ where: { documentId: session.customer.id } });
  const created = await call('POST', '/carts', {
    body: { locationRef: 'Q1', receiveMethod: { kind: 'pickup' } },
    headers: auth,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  await call('POST', '/carts/current/lines', {
    body: {
      sellableUid: 'bun-bo',
      quantity: 2,
      selected: [{ groupUid: 'size', optionUid: 'lon' }],
      note: 'ít bún',
    },
    headers: auth,
  });
  await call('POST', '/carts/current/lines', {
    body: { sellableUid: 'tra-dao', quantity: 1 },
    headers: auth,
  });
  await call('PATCH', '/carts/current', {
    body: { contact: { name: 'Khách đặt lại', phone: '0901234567' } },
    headers: auth,
  });
  const placed = await call('POST', '/carts/current/checkout', {
    body: { consent: { policyVersion: 'v1', accepted: true }, captchaToken: 'pass' },
    headers: { ...auth, 'idempotency-key': `checkout-${randomUUID()}` },
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const code = placed.body.order.code;

  const reorder = await call('POST', `/me/orders/${code}/reorder`, { headers: auth });
  assert.equal(reorder.status, 200, JSON.stringify(reorder.body));
  assert.deepEqual(reorder.body.unavailable, []);
  assert.equal(reorder.body.cart.locationRef, 'Q1');
  assert.equal(reorder.body.cart.receiveMethod.kind, 'pickup');
  const bunBo = reorder.body.cart.lines.find((line) => line.sellableUid === 'bun-bo');
  const traDao = reorder.body.cart.lines.find((line) => line.sellableUid === 'tra-dao');
  assert.equal(bunBo.quantity, 2);
  assert.deepEqual(bunBo.selected, [{ groupUid: 'size', optionUid: 'lon', quantity: 1 }]);
  assert.equal(bunBo.note, 'ít bún');
  assert.equal(traDao.quantity, 1);
  assert.equal(reorder.body.cart.contact.phone, '+84901234567', 'order contact fills the cart');
  console.log('[ordering-test] reorder: lines/options/note rebuilt into the cart');

  // Stale product → unavailable, survivors keep reordering.
  catalog.seed([
    sellable({
      ref: { uid: 'tra-dao' },
      productType: 'test-food',
      title: 'Trà đào',
      listPrice: { amount: 45000, currency: 'VND' },
      isActive: false,
    }),
  ]);
  const degraded = await call('POST', `/me/orders/${code}/reorder`, { headers: auth });
  assert.equal(degraded.status, 200, JSON.stringify(degraded.body));
  assert.equal(degraded.body.unavailable.length, 1);
  assert.equal(degraded.body.unavailable[0].title, 'Trà đào');
  assert.equal(degraded.body.cart.lines.length, 1, 'only bún bò is still sellable');
  assert.equal(degraded.body.cart.lines[0].sellableUid, 'bun-bo');
  assert.equal(degraded.body.cart.lines[0].quantity, 2);
  // Reorder replaces, never merges: a second run leaves exactly one bún bò line.
  const again = await call('POST', `/me/orders/${code}/reorder`, { headers: auth });
  assert.equal(again.body.cart.lines.length, 1, 'reorder is idempotent — same cart contents');
  // Foreign code → 404; no session → 401.
  const stranger = await login('stranger@example.com');
  assert.equal(
    (await call('POST', `/me/orders/${code}/reorder`, {
      headers: { 'x-customer-token': stranger.token },
    })).body.error.code,
    'ORDER_NOT_FOUND',
    'a foreign order code is a 404',
  );
  assert.equal(
    (await call('POST', `/me/orders/${code}/reorder`)).body.error.code,
    'CUSTOMER_AUTH_REQUIRED',
  );
  console.log('[ordering-test] reorder: stale → unavailable, foreign 404, guest 401');

  // ── Reminder eligibility: consent + branch flag + email + idle ───────────────────────
  // The reorder cart is active with lines at Q1; consent not yet granted → no mail.
  await branches().update({ where: { code: 'Q1' }, data: { cartReminderEnabled: true } });
  const idle = new Date(Date.now() - 3 * 3_600_000);
  const activeCart = await carts().findOne({ where: { customer: customer.id, status: 'active' } });
  await carts().update({ where: { id: activeCart.id }, data: { lastActivityAt: idle } });
  let result = await runCartReminder(app, { owner: 'test:reminder' });
  assert.equal(result.sent, 0, 'no marketing consent → no mail');
  assert.equal(reminders().length, 0);
  console.log('[ordering-test] no consent → no reminder');

  // Grant marketing consent → one mail with items + branch, then silence.
  const consent = await call('PUT', '/me', {
    body: { marketingConsent: { granted: true } },
    headers: auth,
  });
  assert.equal(consent.status, 200, JSON.stringify(consent.body));
  result = await runCartReminder(app, { owner: 'test:reminder' });
  assert.equal(result.sent, 1, 'consented idle cart → one mail');
  assert.equal(reminders().length, 1);
  assert.equal(reminders()[0].to, 'reorder@example.com', 'profile email is the fallback target');
  assert.match(reminders()[0].text, /Bún bò/, 'cart item titles are in the mail');
  assert.match(reminders()[0].text, /Quận 1/, 'branch name is in the mail');
  const row = await carts().findOne({ where: { id: activeCart.id } });
  assert.ok(row.reminderSentAt, 'reminderSentAt stamped');
  result = await runCartReminder(app, { owner: 'test:reminder' });
  assert.equal(result.sent, 0, 'a sent reminder never repeats');
  assert.equal(reminders().length, 1);
  const rows = await deliveries().findMany({ where: { template: 'customer.cart-reminder' } });
  assert.equal(rows.length, 1, 'one delivery row, deduped by the deterministic event id');
  assert.match(rows[0].recipientHash, /^[0-9a-f]{64}$/, 'recipient stored hashed only');
  assert.equal(rows[0].status, 'sent');
  console.log('[ordering-test] consented idle cart → exactly one reminder mail');

  // Branch flag off (Q3) → nothing even with consent.
  const session2 = await login('branch-off@example.com');
  const auth2 = { 'x-customer-token': session2.token };
  await call('PUT', '/me', { body: { marketingConsent: { granted: true } }, headers: auth2 });
  await call('POST', '/carts', {
    body: { locationRef: 'Q3', receiveMethod: { kind: 'pickup' } },
    headers: auth2,
  });
  await call('POST', '/carts/current/lines', { body: { sellableUid: 'bun-bo', quantity: 1 }, headers: auth2 });
  const customer2 = await app.db
    .query('plugin::ordering.customer')
    .findOne({ where: { documentId: session2.customer.id } });
  const q3Cart = await carts().findOne({ where: { customer: customer2.id, status: 'active' } });
  await carts().update({ where: { id: q3Cart.id }, data: { lastActivityAt: idle } });
  result = await runCartReminder(app, { owner: 'test:reminder' });
  assert.equal(result.sent, 0, 'branch without cartReminderEnabled sends nothing');
  assert.equal(reminders().length, 1);
  console.log('[ordering-test] branch flag off → no reminder');

  // A recently-active consented cart is not idle → nothing.
  const session3 = await login('fresh@example.com');
  const auth3 = { 'x-customer-token': session3.token };
  await call('PUT', '/me', { body: { marketingConsent: { granted: true } }, headers: auth3 });
  await call('POST', '/carts', {
    body: { locationRef: 'Q1', receiveMethod: { kind: 'pickup' } },
    headers: auth3,
  });
  await call('POST', '/carts/current/lines', { body: { sellableUid: 'bun-bo', quantity: 1 }, headers: auth3 });
  result = await runCartReminder(app, { owner: 'test:reminder' });
  assert.equal(result.sent, 0, 'a fresh cart is not idle');
  assert.equal(reminders().length, 1);
  console.log('[ordering-test] recently-active cart → no reminder');

  // Guest carts never qualify (no consent record); a failed send retries once, then sends.
  const guest = await call('POST', '/carts', {
    body: { locationRef: 'Q1', receiveMethod: { kind: 'pickup' } },
  });
  assert.equal(guest.status, 201);
  await call('POST', '/carts/current/lines', {
    body: { sellableUid: 'bun-bo', quantity: 1 },
    headers: { 'x-cart-token': guest.body.cartToken },
  });
  const customer3 = await app.db
    .query('plugin::ordering.customer')
    .findOne({ where: { documentId: session3.customer.id } });
  const idleCarts = await carts().findMany({ where: { status: 'active' } });
  for (const row of idleCarts) {
    await carts().update({ where: { id: row.id }, data: { lastActivityAt: idle } });
  }
  capture.failNext = 1;
  result = await runCartReminder(app, { owner: 'test:reminder' });
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1, 'the consented fresh cart fails its first send');
  assert.equal(reminders().length, 1);
  const freshCart = await carts().findOne({ where: { customer: customer3.id } });
  assert.equal(freshCart.reminderSentAt, null, 'a failed send retries instead of marking');
  result = await runCartReminder(app, { owner: 'test:reminder' });
  assert.equal(result.sent, 1, 'the retried send lands once');
  assert.equal(reminders().length, 2, 'the guest cart never mailed; the retry added one');
  result = await runCartReminder(app, { owner: 'test:reminder' });
  assert.equal(result.sent, 0);
  assert.equal(reminders().length, 2, 'still exactly one mail per eligible cart');
  console.log('[ordering-test] guest cart skipped; failed send retries once, then silence');

  console.log('[ordering-test] done');
});
