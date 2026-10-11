import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Trusted visitor-IP forwarding lets each section use its own rate-limit bucket.
process.env.FORM_INTAKE_SHARED_SECRET = 'storefront-test-secret';

import { seedBranches, seedMenu, withApp } from './_harness.mjs';

// O3 step 5: public storefront API over HTTP — server-side prices, PRICE_CHANGED,
// SLOT_TOO_EARLY, LOCATION_UNAVAILABLE, MIN_ORDER_NOT_MET, captcha, consent, Idempotency-Key
// (same token on replay), token only in X-Order-Token, own-order-only reads, customer cancel,
// rate limit 429, and the last seat of a slot over HTTP.
withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const branchRows = app.db.query('plugin::ordering.branch');
  const q1 = await branchRows.findOne({ where: { code: 'Q1' } });
  await branchRows.update({
    where: { id: q1.id },
    data: {
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          minOrderAmount: 50000,
          schedule: {
            leadTimeMinutes: 60,
            slotLengthMinutes: 30,
            capacity: 1,
            maxAdvanceDays: 3,
            openingHours: { mode: '24_7' },
          },
        },
      },
    },
  });
  const q3 = await branchRows.findOne({ where: { code: 'Q3' } });
  await branchRows.update({ where: { id: q3.id }, data: { onlineOrdering: false } });
  app.config.set('plugin::ordering.storefront.rateLimits.quote', { max: 40, windowMs: 60_000 });

  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  let visitor = 1;
  const freshIp = () => `192.0.2.${visitor++}`;
  const call = async (method, path, { body, headers = {}, ip = freshIp() } = {}) => {
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

  // --- Config + slots ---------------------------------------------------------------------
  const config = await call('GET', '/config?branch=Q1');
  assert.equal(config.status, 200);
  assert.equal(config.body.consentPolicyVersion, 'v1');
  assert.equal(config.body.branch.pickup.leadTimeMinutes, 60);
  assert.deepEqual(config.body.branch.pickup.paymentMethods, ['cash']);
  assert.equal((await call('GET', '/config?branch=Q3')).body.error.code, 'LOCATION_UNAVAILABLE');

  const tomorrow = config.body.branch.pickup.bookableFrom;
  const dayAfter = new Date(`${tomorrow}T00:00:00Z`);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  const slotDate = dayAfter.toISOString().slice(0, 10);
  const slots = await call('GET', `/slots?branch=Q1&date=${slotDate}`);
  assert.equal(slots.status, 200);
  const open = slots.body.items.filter((slot) => slot.available);
  assert.ok(open.length >= 4, 'tomorrow has open slots');
  const [slotA, slotB, slotC] = open;

  const cart = (overrides = {}) => ({
    branch: 'Q1',
    locale: 'vi',
    lines: [{ sellableUid: 'bun-bo', quantity: 1, unitAmount: 1, lineTotalAmount: 1 }],
    receiveMethod: { kind: 'pickup', slot: { startsAt: slotA.startsAt } },
    totals: { grandTotal: 1 },
    adjustments: [{ kind: 'discount', code: 'free', label: 'free', amount: -65000 }],
    fulfillmentAmount: -10,
    ...overrides,
  });

  // --- Quote: server prices, client amounts ignored ------------------------------------------
  const quote = await call('POST', '/quote', { body: cart() });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.totals.grandTotal, 65000, 'client amounts/adjustments are ignored');
  assert.equal(quote.body.adjustments.length, 0);
  assert.equal(quote.body.timing.mode, 'scheduled');

  const tooEarly = new Date(Date.now() + 30 * 60_000);
  tooEarly.setUTCMinutes(tooEarly.getUTCMinutes() < 30 ? 30 : 60, 0, 0);
  const early = await call('POST', '/quote', {
    body: cart({ receiveMethod: { kind: 'pickup', slot: { startsAt: tooEarly.toISOString() } } }),
  });
  assert.equal(early.status, 400);
  assert.equal(early.body.error.code, 'SLOT_TOO_EARLY');
  assert.ok(early.body.error.details.earliest);
  assert.equal(
    (await call('POST', '/quote', { body: cart({ branch: 'Q3' }) })).body.error.code,
    'LOCATION_UNAVAILABLE',
  );
  assert.equal(
    (await call('POST', '/quote', { body: cart({ lines: [{ sellableUid: 'goi-cuon', quantity: 1 }] }) }))
      .body.error.code,
    'MIN_ORDER_NOT_MET',
  );

  // --- Create -----------------------------------------------------------------------------
  const order = (overrides = {}) => ({
    ...cart(),
    contact: { name: 'Khách test', phone: '0901 234 567' },
    consent: { policyVersion: 'v1', accepted: true },
    captchaToken: 'pass',
    expectedCartHash: quote.body.cartHash,
    ...overrides,
  });
  const key = () => ({ 'Idempotency-Key': `test-${randomUUID()}` });

  assert.equal((await call('POST', '/orders', { body: order() })).body.error.details.field, 'Idempotency-Key');
  assert.equal(
    (await call('POST', '/orders', { body: order({ captchaToken: 'nope' }), headers: key() })).body.error.code,
    'CAPTCHA_FAILED',
  );
  assert.equal(
    (await call('POST', '/orders', { body: order({ consent: { policyVersion: 'v1' } }), headers: key() })).body
      .error.code,
    'CONSENT_REQUIRED',
  );
  assert.equal(
    (await call('POST', '/orders', { body: order({ expectedCartHash: 'stale' }), headers: key() })).body.error.code,
    'PRICE_CHANGED',
  );
  assert.equal(
    (await call('POST', '/orders', {
      body: order({ contact: { phone: '12345' } }),
      headers: key(),
    })).body.error.details.field,
    'contact.phone',
  );

  const firstKey = key();
  const created = await call('POST', '/orders', { body: order(), headers: firstKey });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const token = created.body.token;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(created.body.order.totals.total, 65000);
  assert.equal(created.body.order.receive.slot.startsAt, slotA.startsAt);
  assert.equal(created.body.order.canCancel, true);
  assert.ok(!('phone' in created.body.order.contact), 'phone is not echoed');

  const replay = await call('POST', '/orders', { body: order(), headers: firstKey });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.token, token, 'replay returns the same token');
  assert.equal(await app.db.query('plugin::ordering.order').count(), 1, 'no second order');
  const stored = await app.db.query('plugin::ordering.order').findOne({});
  assert.equal(stored.contactSnapshot.phone, '+84901234567', 'phone stored as E.164');

  // --- Last seat over HTTP (capacity 1): slotA is taken; race two orders for slotB -------------
  const raceBody = order({ receiveMethod: { kind: 'pickup', slot: { startsAt: slotB.startsAt } }, expectedCartHash: undefined });
  const race = await Promise.all([
    call('POST', '/orders', { body: raceBody, headers: key() }),
    call('POST', '/orders', { body: raceBody, headers: key() }),
  ]);
  assert.deepEqual(race.map((res) => res.status).sort(), [201, 409]);
  assert.equal(race.find((res) => res.status === 409).body.error.code, 'SLOT_FULL');
  const taken = await call('POST', '/quote', { body: cart({ receiveMethod: { kind: 'pickup', slot: { startsAt: slotA.startsAt } } }) });
  assert.equal(taken.body.error.code, 'SLOT_FULL', 'a taken slot quotes as full');

  // --- Token reads ------------------------------------------------------------------------
  const tokenHeader = (value) => ({ 'X-Order-Token': value });
  const shown = await call('GET', '/orders', { headers: tokenHeader(token) });
  assert.equal(shown.status, 200);
  assert.equal(shown.body.order.code, created.body.order.code);
  const other = race.find((res) => res.status === 201).body;
  assert.equal(
    (await call('GET', '/orders', { headers: tokenHeader(other.token) })).body.order.code,
    other.order.code,
    'each token reads only its own order',
  );
  assert.equal((await call('GET', `/orders?token=${token}`)).body.error.code, 'ORDER_TOKEN_INVALID');
  assert.equal((await call('GET', `/orders?t=${token}`, { headers: tokenHeader(token) })).status, 401);
  assert.equal((await call('GET', '/orders', { headers: tokenHeader('x'.repeat(43)) })).status, 401);
  assert.equal((await call('GET', '/orders')).status, 401);

  const payment = await call('GET', '/orders/payment', { headers: tokenHeader(token) });
  assert.equal(payment.status, 200);
  assert.deepEqual(
    { due: payment.body.payment.due, methods: payment.body.payment.methods, timing: payment.body.payment.paymentTiming },
    { due: 65000, methods: ['cash'], timing: 'pay-on-pickup' },
  );

  // --- Customer cancel frees the slot ---------------------------------------------------------
  const canceled = await call('POST', '/orders/cancel', { headers: tokenHeader(token), body: { reason: 'đổi ý' } });
  assert.equal(canceled.status, 200, JSON.stringify(canceled.body));
  assert.equal(canceled.body.order.status, 'canceled');
  assert.equal(canceled.body.order.canCancel, false);
  assert.equal(
    (await call('POST', '/orders/cancel', { headers: tokenHeader(token), body: {} })).body.error.code,
    'CANCEL_NOT_ALLOWED',
  );
  const freed = await call('POST', '/quote', { body: cart() });
  assert.equal(freed.status, 200, 'the canceled order released slotA');

  // --- Rate limit -------------------------------------------------------------------------
  const ip = freshIp();
  let status = 200;
  for (let index = 0; index < 41 && status !== 429; index += 1) {
    status = (await call('POST', '/quote', { body: cart({ receiveMethod: { kind: 'pickup', slot: { startsAt: slotC.startsAt } } }), ip })).status;
  }
  assert.equal(status, 429, 'quote is rate limited per visitor');

  // --- Body size cap ----------------------------------------------------------------------
  const huge = await call('POST', '/quote', { body: cart({ padding: 'x'.repeat(40 * 1024) }) });
  assert.equal(huge.status, 413);
  console.log('[ordering-test] storefront: prices, slots, captcha, consent, idempotent token, token reads, cancel, 429, 413 verified');
});
