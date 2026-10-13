// Cart promotion code (O8 × O11): PATCH /carts/current takes `promotionCode`; every cart read
// re-quotes with it; checkout passes it to createOrder; clearing it drops the discount; the cart
// goes through the same per-IP guessing guard as POST /quote (captcha after 3 wrong codes).
// Run: ORDERING_TEST_DATABASE=salanca_ordering_finish node scripts/ordering/cart-promotion.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Trusted visitor-IP forwarding lets the test pin one IP for the guessing guard.
process.env.FORM_INTAKE_SHARED_SECRET = 'storefront-test-secret';

import { seedBranches, seedMenu, withApp } from './_harness.mjs';

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const promo = await app.db.query('plugin::ordering.promotion').create({
    data: {
      name: { vi: 'Giỏ giảm 10%' },
      kind: 'code',
      discountType: 'percent',
      value: 10,
      target: { kind: 'order', refs: [] },
      minSubtotal: 0,
      locationRefs: null,
      receiveKinds: ['pickup', 'delivery'],
      startsAt: '2026-01-01T00:00:00.000Z',
      weekdays: [],
      timeRanges: [],
      firstOrderOnly: false,
      stackable: false,
      priority: 0,
      active: true,
      usedCount: 0,
    },
  });
  await app.db.query('plugin::ordering.promotion-code').create({
    data: { promotionId: promo.id, code: 'GIO10', usedCount: 0, active: true },
  });

  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  const call = async (method, path, { body, headers = {}, ip = '198.51.100.40' } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'x-salanca-intake-secret': 'storefront-test-secret',
        'x-salanca-visitor-ip': ip,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  const created = await call('POST', '/carts', {
    body: { locationRef: 'Q1', receiveMethod: { kind: 'pickup' }, locale: 'vi' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const cart = { 'x-cart-token': created.body.cartToken };
  await call('POST', '/carts/current/lines', { body: { sellableUid: 'bun-bo', quantity: 2 }, headers: cart });

  const applied = await call('PATCH', '/carts/current', { body: { promotionCode: ' gio10 ' }, headers: cart });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.cart.promotionCode, 'GIO10');
  assert.equal(applied.body.quote.promotions[0].code, 'GIO10');
  assert.equal(applied.body.quote.totals.grandTotal, 117000, '130.000 − 10%');
  const reread = await call('GET', '/carts/current', { headers: cart });
  assert.equal(reread.body.quote.totals.grandTotal, 117000, 'every read re-quotes with the stored code');
  console.log('[ordering-test] cart code: stored upper-case, quoted on every read (117.000)');

  // Guessing through the cart counts like /quote: 3 wrong codes, then a captcha is required.
  const guesser = '198.51.100.41';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const wrong = await call('PATCH', '/carts/current', { body: { promotionCode: `SAI${attempt}Z` }, headers: cart, ip: guesser });
    assert.equal(wrong.status, 200);
    assert.equal(wrong.body.quote.rejectedPromotions[0].reason, 'invalid');
    assert.equal(wrong.body.quote.totals.grandTotal, 130000);
  }
  const blocked = await call('PATCH', '/carts/current', { body: { promotionCode: 'SAI9Z' }, headers: cart, ip: guesser });
  assert.equal(blocked.body.error?.code, 'CAPTCHA_FAILED');
  const withCaptcha = await call('PATCH', '/carts/current', {
    body: { promotionCode: 'GIO10', captchaToken: 'pass' },
    headers: cart,
    ip: guesser,
  });
  assert.equal(withCaptcha.status, 200);
  assert.equal(withCaptcha.body.quote.totals.grandTotal, 117000);
  console.log('[ordering-test] cart code: 3 wrong codes from one IP, then a captcha is required');

  const cleared = await call('PATCH', '/carts/current', { body: { promotionCode: null }, headers: cart });
  assert.equal(cleared.body.cart.promotionCode, null);
  assert.equal(cleared.body.quote.totals.grandTotal, 130000);
  await call('PATCH', '/carts/current', { body: { promotionCode: 'GIO10', contact: { name: 'Khách', phone: '0907000111' } }, headers: cart });

  const placed = await call('POST', '/carts/current/checkout', {
    body: { consent: { policyVersion: 'v1', accepted: true }, captchaToken: 'pass' },
    headers: { ...cart, 'idempotency-key': `checkout-${randomUUID()}` },
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const order = await app.db.query('plugin::ordering.order').findOne({ where: { code: placed.body.order.code } });
  assert.equal(Number(order.adjustmentAmount), -13000);
  assert.equal(Number(order.totalAmount), 117000);
  assert.equal(await app.db.query('plugin::ordering.promotion-redemption').count({ where: { promotionId: promo.id } }), 1);
  console.log('[ordering-test] cart checkout carries the code: order 117.000 with one redemption');
});
