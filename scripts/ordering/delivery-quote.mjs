import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.FORM_INTAKE_SHARED_SECRET = 'delivery-quote-test-secret';

import { seedBranches, seedMenu, withApp } from './_harness.mjs';

// O5 step 3: the self-delivery provider prices the cart. The quote fee is the fee on the
// order, the grand total includes it, and the stored snapshot keeps catalog names only.
const zone = {
  code: 'near',
  label: 'Gần',
  priority: 10,
  match: { kind: 'commune', communeCodes: ['XT01001', 'XT01002'] },
  rules: [
    { when: 'subtotal-lt', subtotal: 100000, fee: 'unavailable' },
    { when: 'subtotal-lt', subtotal: 300000, fee: 15000 },
    { when: 'any', fee: 0 },
  ],
  minOrderAmount: 100000,
  extraLeadTimeMinutes: 30,
};

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const branches = app.db.query('plugin::ordering.branch');
  const q1 = await branches.findOne({ where: { code: 'Q1' } });
  await branches.update({
    where: { id: q1.id },
    data: {
      onlineOrdering: true,
      fulfillment: {
        delivery: {
          enabled: true,
          orderTiming: 'both',
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          minOrderAmount: 0,
          schedule: {
            leadTimeMinutes: 60,
            slotLengthMinutes: 15,
            capacity: 8,
            openingHours: { mode: '24_7' },
          },
          zones: [zone],
        },
      },
    },
  });
  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  const call = async (method, path, { body, headers = {} } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'x-salanca-intake-secret': 'delivery-quote-test-secret',
        'x-salanca-visitor-ip': '192.0.2.40',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  const address = {
    communeCode: 'xt01002',
    line1: '12 Đường Bí Mật',
    recipientName: 'Lan Thử',
    phone: '0901234567',
    wardName: 'HACKED',
    provinceName: 'HACKED',
  };
  const cart = (overrides = {}) => ({
    branch: 'Q1',
    lines: [{ sellableUid: 'bun-bo', quantity: 2 }],
    receiveMethod: { kind: 'delivery', address },
    fulfillmentAmount: 1,
    ...overrides,
  });

  const quote = await call('POST', '/quote', { body: cart() });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.totals.subtotal, 130000);
  assert.equal(quote.body.totals.fulfillmentTotal, 15000);
  assert.equal(quote.body.totals.grandTotal, 145000, 'client fulfillmentAmount is ignored');
  assert.equal(quote.body.delivery.fee, 15000);
  assert.equal(quote.body.delivery.freeFrom, 300000);
  assert.equal(quote.body.delivery.extraLeadTimeMinutes, 30);
  assert.equal(quote.body.timing.mode, 'asap');
  const leadMs = Date.parse(quote.body.timing.requestedReadyAt) - Date.now();
  assert.ok(leadMs >= 85 * 60_000, `delivery lead includes the zone extra (${leadMs}ms)`);
  assert.ok(leadMs < 120 * 60_000, `delivery lead is not unbounded (${leadMs}ms)`);

  const low = await call('POST', '/quote', {
    body: cart({ lines: [{ sellableUid: 'bun-bo', quantity: 1 }] }),
  });
  assert.equal(low.status, 400);
  assert.equal(low.body.error.code, 'DELIVERY_UNAVAILABLE');
  assert.equal(low.body.error.details.reason, 'below-minimum');
  assert.equal(JSON.stringify(low.body).includes('Bí Mật'), false);
  assert.equal(JSON.stringify(low.body).includes('Lan'), false);

  const outside = await call('POST', '/quote', {
    body: cart({ receiveMethod: { kind: 'delivery', address: { ...address, communeCode: 'XT02002' } } }),
  });
  assert.equal(outside.body.error.code, 'DELIVERY_UNAVAILABLE');
  assert.equal(outside.body.error.details.reason, 'outside');
  assert.deepEqual(Object.keys(outside.body.error.details).sort(), ['communeCode', 'reason']);

  const created = await call('POST', '/orders', {
    body: {
      ...cart(),
      contact: { name: 'Lan', phone: '0901234567' },
      consent: { policyVersion: 'v1', accepted: true },
      captchaToken: 'pass',
      expectedCartHash: quote.body.cartHash,
    },
    headers: { 'Idempotency-Key': `delivery-${randomUUID()}` },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.order.totals.total, 145000);
  assert.equal(created.body.order.totals.fulfillment, 15000);
  assert.equal(JSON.stringify(created.body).includes('Bí Mật'), false, 'the public order view hides the street');

  const stored = await app.db.query('plugin::ordering.fulfillment').findMany({});
  assert.equal(stored.length, 1);
  const snapshot = stored[0].addressSnapshot;
  assert.equal(snapshot.wardCode, 'XT01002');
  assert.equal(snapshot.wardName, 'Xã Đồng Thử');
  assert.equal(snapshot.provinceCode, 'XT01');
  assert.equal(snapshot.provinceName, 'Tỉnh Thử Một');
  assert.equal(snapshot.phone, '+84901234567');
  assert.equal(JSON.stringify(snapshot).includes('HACKED'), false);
  assert.equal(stored[0].providerCode, 'self-delivery');
  assert.equal(stored[0].trackingNumber ?? null, null);

  await branches.update({
    where: { id: q1.id },
    data: { fulfillment: { delivery: { enabled: false, zones: [zone] } } },
  });
  const disabled = await call('POST', '/quote', { body: cart() });
  assert.equal(disabled.body.error.code, 'DELIVERY_UNAVAILABLE');
  assert.equal(disabled.body.error.details.reason, 'disabled');

  console.log('[ordering-test] delivery quote: fee, total, snapshot and refusal verified');
});
