// O11 step 4 gate (cart checkout): /carts/current/checkout maps the live cart onto createOrder —
// consent + captcha enforced, the cart flips to `converted` (410 afterwards), the Idempotency-Key
// replay answers the same order token, and a session cart without stored contact falls back to
// the customer profile phone/name. Order rows link order.customer exactly like POST /orders.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Trusted visitor-IP forwarding gives each client its own rate-limit bucket.
process.env.FORM_INTAKE_SHARED_SECRET = 'storefront-test-secret';

import { seedBranches, seedMenu, withApp } from './_harness.mjs';

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const plugin = app.plugin('ordering');
  const capture = plugin.service('registry').notificationProvider('email');

  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  let visitor = 1;
  const call = async (method, path, { body, headers = {} } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'x-salanca-intake-secret': 'storefront-test-secret',
        'x-salanca-visitor-ip': `192.0.4.${visitor++}`,
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
  const newCart = async (headers = {}) => {
    const res = await call('POST', '/carts', {
      body: { locationRef: 'Q1', receiveMethod: { kind: 'pickup' }, locale: 'vi' },
      headers,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.cartToken;
  };
  const withCart = (token) => ({ 'x-cart-token': token });
  const addLine = async (token, line) =>
    call('POST', '/carts/current/lines', { body: line, headers: withCart(token) });
  const checkout = async (headers, body = {}) =>
    call('POST', '/carts/current/checkout', {
      body: {
        consent: { policyVersion: 'v1', accepted: true },
        captchaToken: 'pass',
        ...body,
      },
      headers: { 'idempotency-key': `checkout-${randomUUID()}`, ...headers },
    });

  // ── Guard rails: consent, captcha, contact ──────────────────────────────────────────────
  const token1 = await newCart();
  await addLine(token1, { sellableUid: 'goi-cuon', quantity: 2 });
  assert.equal(
    (await call('POST', '/carts/current/checkout', {
      body: { captchaToken: 'pass', idempotencyKey: 'k' + randomUUID() },
      headers: withCart(token1),
    })).body.error.code,
    'CONSENT_REQUIRED',
    'checkout needs consent.accepted',
  );
  assert.equal(
    (await checkout(withCart(token1), { captchaToken: 'nope' })).body.error.code,
    'CAPTCHA_FAILED',
  );
  assert.equal(
    (await checkout(withCart(token1))).body.error.details.field,
    'contact.phone',
    'a guest cart without contact cannot checkout',
  );

  // ── Guest checkout: contact on the cart, order + token out, cart converts ───────────────
  await call('PATCH', '/carts/current', {
    body: { contact: { name: 'Khách giỏ', phone: '0901234567' } },
    headers: withCart(token1),
  });
  const key = { 'idempotency-key': `checkout-${randomUUID()}` };
  const placed = await call('POST', '/carts/current/checkout', {
    body: { consent: { policyVersion: 'v1', accepted: true, marketingOptIn: true }, captchaToken: 'pass' },
    headers: { ...withCart(token1), ...key },
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  assert.equal(placed.body.replayed, false);
  assert.match(placed.body.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(placed.body.order.totals.total, 30000);
  const order = await app.db.query('plugin::ordering.order').findOne({
    where: { code: placed.body.order.code },
  });
  assert.equal(order.contactSnapshot.phone, '+84901234567', 'cart contact became the snapshot');
  const cartRow = await app.db.query('plugin::ordering.cart').findOne({
    where: { order: order.id },
    populate: { order: true },
  });
  assert.equal(cartRow.status, 'converted');
  assert.equal(cartRow.order.id, order.id, 'cart carries the converted order link');
  assert.equal(
    (await call('GET', '/carts/current', { headers: withCart(token1) })).body.error.code,
    'CART_EXPIRED',
    'a converted cart is dead',
  );

  // Idempotent: same key → same order, no second order row.
  const replay = await call('POST', '/carts/current/checkout', {
    body: { consent: { policyVersion: 'v1', accepted: true, marketingOptIn: true }, captchaToken: 'pass' },
    headers: { ...withCart(token1), ...key },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.token, placed.body.token);
  assert.equal(await app.db.query('plugin::ordering.order').count(), 1, 'no duplicate order');
  // A different key against the converted cart must NOT mint a second order.
  const hijack = await call('POST', '/carts/current/checkout', {
    body: { consent: { policyVersion: 'v1', accepted: true }, captchaToken: 'pass' },
    headers: { ...withCart(token1), 'idempotency-key': `checkout-${randomUUID()}` },
  });
  assert.equal(hijack.body.error.code, 'CART_EXPIRED', JSON.stringify(hijack.body));
  assert.equal(await app.db.query('plugin::ordering.order').count(), 1, 'no second order');
  console.log('[ordering-test] checkout: consent/captcha/contact, converts cart, replay-safe');

  // ── Session cart: profile-phone fallback + order.customer set ──────────────────────────
  // Concurrent stale snapshots: different keys must create at most one order.
  const raceToken = await newCart();
  await addLine(raceToken, { sellableUid: 'goi-cuon', quantity: 1 });
  await call('PATCH', '/carts/current', { body: { contact: { phone: '0901234567' } }, headers: withCart(raceToken) });
  const cartService = plugin.service('cart');
  const ctx = { actor: { kind: 'customer' }, requestId: randomUUID() };
  const stale = await cartService.resolve({ cartToken: raceToken, customerId: null }, ctx);
  const countBefore = await app.db.query('plugin::ordering.order').count();
  const input = { consent: { policyVersion: 'v1' }, customerId: null };
  const competing = await Promise.allSettled(['a', 'b'].map((suffix) => cartService.checkout(
    stale, { ...input, idempotencyKey: `race-${randomUUID()}-${suffix}` }, ctx,
  )));
  assert.equal(competing.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(competing.find((r) => r.status === 'rejected').reason.code, 'CART_EXPIRED');
  assert.equal(await app.db.query('plugin::ordering.order').count(), countBefore + 1);
  const winner = competing.find((r) => r.status === 'fulfilled').value;
  const converted = await app.db.query('plugin::ordering.cart').findOne({ where: { id: stale.id }, populate: { order: true } });
  assert.equal(converted.order.id, winner.order.order.id);

  const sameToken = await newCart();
  await addLine(sameToken, { sellableUid: 'goi-cuon', quantity: 1 });
  await call('PATCH', '/carts/current', { body: { contact: { phone: '0901234567' } }, headers: withCart(sameToken) });
  const sameRow = await cartService.resolve({ cartToken: sameToken, customerId: null }, ctx);
  const sameInput = { ...input, idempotencyKey: `same-${randomUUID()}` };
  const same = await Promise.all([cartService.checkout(sameRow, sameInput, ctx), cartService.checkout(sameRow, sameInput, ctx)]);
  assert.equal(same[0].publicToken, same[1].publicToken);
  assert.equal(same[0].order.order.id, same[1].order.order.id);
  assert.equal(same.filter((r) => r.replayed).length, 1);
  assert.equal(await app.db.query('plugin::ordering.order').count(), countBefore + 2);
  await assert.rejects(cartService.checkout(converted, sameInput, ctx), { code: 'CART_EXPIRED' });
  // Inject a failure after order creation; both the order and its idempotency row must
  // roll back with checkout, leaving the cart active and retryable.
  const rollbackToken = await newCart();
  await addLine(rollbackToken, { sellableUid: 'goi-cuon', quantity: 1 });
  await call('PATCH', '/carts/current', { body: { contact: { phone: '0901234567' } }, headers: withCart(rollbackToken) });
  const rollbackRow = await cartService.resolve({ cartToken: rollbackToken, customerId: null }, ctx);
  const rollbackInput = { ...input, idempotencyKey: `rollback-${randomUUID()}` };
  const orderService = plugin.service('order');
  const originalCreate = orderService.createOrder;
  orderService.createOrder = async (...args) => {
    await originalCreate.apply(orderService, args);
    throw new Error('injected-checkout-failure');
  };
  try {
    await assert.rejects(cartService.checkout(rollbackRow, rollbackInput, ctx), /injected-checkout-failure/);
  } finally { orderService.createOrder = originalCreate; }
  assert.equal(await app.db.query('plugin::ordering.order').count(), countBefore + 2);
  assert.equal(await app.db.query('plugin::ordering.idempotency-key').count({ where: { key: rollbackInput.idempotencyKey } }), 0);
  assert.equal((await cartService.resolve({ cartToken: rollbackToken, customerId: null }, ctx)).status, 'active');
  assert.equal((await cartService.checkout(rollbackRow, rollbackInput, ctx)).replayed, false);
  console.log('[ordering-test] checkout concurrency: different keys create one order; same key replays; foreign key refused');

  const session = await login('lan@example.com');
  const auth = { 'x-customer-token': session.token };
  const customer = await app.db
    .query('plugin::ordering.customer')
    .findOne({ where: { documentId: session.customer.id } });
  await app.db.query('plugin::ordering.customer').update({
    where: { id: customer.id },
    data: { phone: '+84907777777', phoneHash: 'x'.repeat(64) },
  });
  const cartA = await call('POST', '/carts', {
    body: { locationRef: 'Q1', receiveMethod: { kind: 'pickup' } },
    headers: auth,
  });
  assert.equal(cartA.status, 201);
  await call('POST', '/carts/current/lines', {
    body: { sellableUid: 'tra-dao', quantity: 1 },
    headers: auth,
  });
  const placedA = await checkout(auth);
  assert.equal(placedA.status, 201, JSON.stringify(placedA.body));
  const orderA = await app.db.query('plugin::ordering.order').findOne({
    where: { code: placedA.body.order.code },
    populate: { customer: true },
  });
  assert.equal(orderA.contactSnapshot.phone, '+84907777777', 'profile phone filled the contact');
  assert.equal(orderA.customer?.id, customer.id, 'order.customer = the session profile');
  // A fresh cart appears for the next shop.
  const next = await call('POST', '/carts', { body: { locationRef: 'Q1' }, headers: auth });
  assert.equal(next.status, 201);
  assert.equal(next.body.cart.lines.length, 0);
  console.log('[ordering-test] session checkout: profile contact fallback, order.customer set');

  // ── O9: a card code at checkout shares the per-IP wrong-code budget → 429 once spent ──
  const probeCart = await call('POST', '/carts', {
    body: { locationRef: 'Q1', receiveMethod: { kind: 'pickup' } },
    headers: auth,
  });
  assert.equal(probeCart.status, 201);
  await call('POST', '/carts/current/lines', {
    body: { sellableUid: 'tra-dao', quantity: 1 },
    headers: auth,
  });
  const probeIp = { ...auth, 'x-salanca-visitor-ip': '192.0.9.9' };
  // Below the generic `create` bucket (10/IP) so the 429 can only come from the card budget.
  const max = 3;
  app.config.get('plugin::ordering').storefront.rateLimits.giftCard.max = max;
  const statuses = [];
  for (let i = 0; i <= max; i += 1) {
    const res = await checkout(probeIp, {
      payment: { providerCode: 'cash', giftCardCode: 'BBBB-BBBB-BBBB-BBBB' },
    });
    statuses.push(res.status);
  }
  assert.ok(statuses.slice(0, max).every((status) => status === 400), JSON.stringify(statuses));
  assert.equal(statuses[max], 429, 'wrong card codes at checkout are rate limited per IP');
  console.log('[ordering-test] checkout: wrong gift-card codes counted, 429 after the budget');
});
