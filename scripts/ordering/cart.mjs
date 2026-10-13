// O11 step 4 gate (cart lifecycle): guest carts addressed by X-Cart-Token (only the hash is
// stored), customer carts by X-Customer-Token. Every read re-quotes server-side: a price change
// between two reads answers the new price, and a sellable that went inactive becomes a per-line
// `issues` entry instead of an error. Line ops, the 50-line cap, sign-in merge (claim + merge),
// foreign-cart scoping, and the cart-expiry job are covered here; checkout has its own script.
import assert from 'node:assert/strict';

// Trusted visitor-IP forwarding gives each client its own rate-limit bucket.
process.env.FORM_INTAKE_SHARED_SECRET = 'storefront-test-secret';

import { seedBranches, seedMenu, withApp } from './_harness.mjs';

const { runCartExpiry } = await import(
  '../../src/plugins/ordering/dist/server/src/jobs/cart-expiry.js'
);

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const branches = () => app.db.query('plugin::ordering.branch');
  const q1 = await branches().findOne({ where: { code: 'Q1' } });
  await branches().update({
    where: { id: q1.id },
    data: {
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          minOrderAmount: 0,
          schedule: {
            leadTimeMinutes: 30,
            slotLengthMinutes: 30,
            capacity: 10,
            maxAdvanceDays: 3,
            openingHours: { mode: '24_7' },
          },
        },
      },
    },
  });
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
        'x-salanca-visitor-ip': `192.0.3.${visitor++}`,
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

  // ── Guest cart: create → token; add/patch/remove lines; live re-quotes ────────────────
  const created = await call('POST', '/carts', {
    body: { locationRef: 'Q1', receiveMethod: { kind: 'pickup' }, locale: 'vi' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.ok(created.body.cartToken, 'guest cart returns a bearer token');
  assert.equal(created.body.quote.totals.grandTotal, 0, 'empty cart quotes zero');
  const token = created.body.cartToken;
  const withCart = (extra = {}) => ({ 'x-cart-token': token, ...extra });

  assert.equal(
    (await call('GET', '/carts/current')).body.error.code,
    'CART_NOT_FOUND',
    'no headers → 404',
  );
  assert.equal(
    (await call('GET', '/carts/current', { headers: { 'x-cart-token': 'nope' } })).body.error
      .code,
    'CART_NOT_FOUND',
    'unknown token → 404',
  );

  const line = await call('POST', '/carts/current/lines', {
    body: {
      sellableUid: 'bun-bo',
      quantity: 2,
      selected: [{ groupUid: 'size', optionUid: 'lon' }],
      note: 'ít bún',
    },
    headers: withCart(),
  });
  assert.equal(line.status, 200, JSON.stringify(line.body));
  assert.equal(line.body.cart.lines.length, 1);
  assert.equal(line.body.quote.totals.grandTotal, 150000, '(65k + 10k option) × 2 re-quoted');
  assert.equal(line.body.quote.lines[0].sellableUid, 'bun-bo');
  const lineId = line.body.cart.lines[0].id;

  // Identical signature tops up quantity; a different option is a second line.
  const topUp = await call('POST', '/carts/current/lines', {
    body: { sellableUid: 'bun-bo', quantity: 1, selected: [{ groupUid: 'size', optionUid: 'lon' }] },
    headers: withCart(),
  });
  assert.equal(topUp.body.cart.lines.length, 1);
  assert.equal(topUp.body.cart.lines[0].quantity, 3);
  const second = await call('POST', '/carts/current/lines', {
    body: { sellableUid: 'goi-cuon', quantity: 4 },
    headers: withCart(),
  });
  assert.equal(second.body.cart.lines.length, 2);
  assert.equal(second.body.quote.totals.grandTotal, 150000 + 75000 + 60000);

  const patched = await call('PATCH', `/carts/current/lines/${lineId}`, {
    body: { quantity: 1, note: 'nhiều bún' },
    headers: withCart(),
  });
  assert.equal(patched.body.cart.lines.find((l) => l.id === lineId).quantity, 1);
  assert.equal(
    (await call('PATCH', '/carts/current/lines/ghost', { body: { quantity: 1 }, headers: withCart() }))
      .status,
    404,
    'foreign lineId → 404',
  );
  const removed = await call('DELETE', `/carts/current/lines/${lineId}`, { headers: withCart() });
  assert.equal(removed.body.cart.lines.length, 1);
  console.log('[ordering-test] /carts guest: token, line ops, live quote');

  // ── Re-quote: a price change between reads answers the new price ───────────────────────
  const catalog = plugin.service('registry').catalogAdapter('test-catalog');
  const goiCuonPriced = (amount) => ({
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
    ref: { uid: 'goi-cuon' },
    productType: 'test-food',
    title: 'Gỏi cuốn',
    listPrice: { amount, currency: 'VND' },
  });
  const before = await call('GET', '/carts/current', { headers: withCart() });
  assert.equal(before.body.quote.totals.grandTotal, 60000);
  catalog.seed([goiCuonPriced(20000)]); // upsert: gỏi cuốn 15k → 20k
  const after = await call('GET', '/carts/current', { headers: withCart() });
  assert.equal(after.body.quote.totals.grandTotal, 80000, 're-priced 15k → 20k between reads');
  assert.notEqual(after.body.quote.cartHash, before.body.quote.cartHash);
  console.log('[ordering-test] re-quote: a price change between reads answers the new price');

  // ── Stale line → issues (dropped from the quote), not an error ────────────────────────
  const live = await call('POST', '/carts/current/lines', {
    body: { sellableUid: 'bun-bo', quantity: 1 },
    headers: withCart(),
  });
  const staleId = live.body.cart.lines.find((l) => l.sellableUid === 'bun-bo').id;
  catalog.seed([
    { ...goiCuonPriced(20000), ref: { uid: 'bun-bo' }, title: 'Bún bò', isActive: false },
  ]);
  const degraded = await call('GET', '/carts/current', { headers: withCart() });
  assert.equal(degraded.status, 200);
  assert.equal(degraded.body.cart.lines.length, 2, 'cart keeps the stale line');
  assert.equal(degraded.body.quote.totals.grandTotal, 80000, 'quote still prices the live line');
  const issue = degraded.body.issues.find((i) => i.code === 'SELLABLE_NOT_FOUND');
  assert.ok(issue, 'the dropped line surfaces as an issue');
  assert.equal(issue.lineId, staleId);
  console.log('[ordering-test] stale sellable → issues entry, dropped from quote');

  // ── Line cap: distinct keys (variantUid) to 50, the 51st is CART_LIMIT ────────────────
  for (let index = 0; index < 48; index += 1) {
    const res = await call('POST', '/carts/current/lines', {
      body: { sellableUid: 'goi-cuon', quantity: 1, variantUid: `v${index}` },
      headers: withCart(),
    });
    assert.equal(res.status, 200, `line ${index}`);
  }
  const fiftyFirst = await call('POST', '/carts/current/lines', {
    body: { sellableUid: 'goi-cuon', quantity: 1, variantUid: 'v-overflow' },
    headers: withCart(),
  });
  assert.equal(fiftyFirst.status, 400);
  assert.equal(fiftyFirst.body.error.code, 'CART_LIMIT');
  console.log('[ordering-test] 50-line cap → CART_LIMIT');

  // ── Sign-in merge: guest cart + session headers merge into the customer cart ──────────
  const sessionA = await login('lan@example.com');
  const authA = { 'x-customer-token': sessionA.token };
  const merged = await call('GET', '/carts/current', { headers: withCart(authA) });
  assert.equal(merged.status, 200, JSON.stringify(merged.body));
  assert.equal(merged.body.cart.lines.length, 50, 'guest cart claimed wholesale');
  const cartRow = await app.db.query('plugin::ordering.cart').findOne({
    where: { documentId: merged.body.cart.id },
    populate: { customer: true },
  });
  assert.ok(cartRow.customer?.id, 'claimed cart now belongs to the customer');
  // Session-only resolve finds the same cart; the old guest token still works (claim case).
  const bySession = await call('GET', '/carts/current', { headers: authA });
  assert.equal(bySession.body.cart.id, merged.body.cart.id);
  assert.equal((await call('GET', '/carts/current', { headers: withCart() })).status, 200);
  // A session cart accepts no bearer token — POST /carts returns the existing cart.
  const again = await call('POST', '/carts', { body: { locationRef: 'Q1' }, headers: authA });
  assert.equal(again.body.cart.id, merged.body.cart.id);
  assert.equal(again.body.cartToken, undefined, 'session carts never get a token');

  // Merge into a non-empty customer cart: quantities sum on identical lines.
  const guest2 = await call('POST', '/carts', {
    body: { locationRef: 'Q1', receiveMethod: { kind: 'pickup' } },
  });
  const token2 = guest2.body.cartToken;
  await call('POST', '/carts/current/lines', {
    body: { sellableUid: 'goi-cuon', quantity: 2 },
    headers: { 'x-cart-token': token2 },
  });
  const merged2 = await call('GET', '/carts/current', {
    headers: { 'x-cart-token': token2, 'x-customer-token': sessionA.token },
  });
  assert.equal(merged2.status, 200);
  assert.equal(merged2.body.cart.id, merged.body.cart.id, 'still the customer cart');
  const goiCuon = merged2.body.cart.lines.find((l) => l.sellableUid === 'goi-cuon' && !l.variantUid);
  assert.equal(goiCuon.quantity, 6, '4 + 2 summed on the identical line');
  assert.equal(
    (await call('GET', '/carts/current', { headers: { 'x-cart-token': token2 } })).body.error.code,
    'CART_EXPIRED',
    'the merged-away guest cart is dead',
  );
  console.log('[ordering-test] sign-in merge: claim, merge-with-dedupe, dead guest token');

  // ── Foreign cart: session B + token of A's cart → B's own cart or 404, never A's ──────
  const sessionB = await login('minh@example.com');
  const cross = await call('GET', '/carts/current', {
    headers: { 'x-cart-token': token, 'x-customer-token': sessionB.token },
  });
  assert.equal(cross.status, 404, 'B + A’s cart token → 404 (B has no cart)');
  const cartB = await call('POST', '/carts', {
    body: { locationRef: 'Q1' },
    headers: { 'x-customer-token': sessionB.token },
  });
  const cross2 = await call('GET', '/carts/current', {
    headers: { 'x-cart-token': token, 'x-customer-token': sessionB.token },
  });
  assert.equal(cross2.body.cart.id, cartB.body.cart.id, 'session cart wins over a foreign token');
  console.log('[ordering-test] foreign cart token + session → never leaks');

  // ── cart-expiry job: past-due carts expire; aged rows are deleted ──────────────────────
  const carts = app.db.query('plugin::ordering.cart');
  const stale = await carts.findOne({ where: { documentId: cartB.body.cart.id } });
  const past = new Date(Date.now() - 60_000);
  await carts.update({ where: { id: stale.id }, data: { expiresAt: past } });
  let result = await runCartExpiry(app, { owner: 'test:cart' });
  assert.equal(result.expired, 1);
  assert.equal(
    (await call('GET', '/carts/current', { headers: { 'x-customer-token': sessionB.token } })).body
      .error.code,
    'CART_NOT_FOUND',
    'an expired customer cart no longer resolves for the session',
  );
  const ancient = new Date(Date.now() - 31 * 86_400_000);
  await carts.update({ where: { id: stale.id }, data: { expiresAt: ancient } });
  result = await runCartExpiry(app, { owner: 'test:cart' });
  assert.equal(result.deleted, 1);
  assert.equal(await carts.findOne({ where: { id: stale.id } }), null, 'aged row hard-deleted');
  result = await runCartExpiry(app, { owner: 'test:cart' });
  assert.deepEqual({ expired: result.expired, deleted: result.deleted }, { expired: 0, deleted: 0 });
  console.log('[ordering-test] cart-expiry: active→expired, 30-day delete, idempotent');
});
