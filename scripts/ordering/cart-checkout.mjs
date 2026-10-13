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
});
