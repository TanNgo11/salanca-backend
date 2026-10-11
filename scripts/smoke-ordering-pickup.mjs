// O3 acceptance smoke (spec "node scripts/smoke-ordering-pickup.mjs"): the whole pickup + cash
// flow over HTTP on the dedicated ordering test database — public config → slots → quote →
// order (Idempotency-Key, captcha, consent) → admin accepts → ready → "Thu tiền và giao" → the
// customer's token view shows a completed, paid order. Never touches the dev or production DB.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.FORM_INTAKE_SHARED_SECRET ||= 'smoke-ordering-secret';

const { seedAdminHttpStaff, seedBranches, seedMenu, withApp } = await import('./ordering/_harness.mjs');

await withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const branches = app.db.query('plugin::ordering.branch');
  const q1 = await branches.findOne({ where: { code: 'Q1' } });
  await branches.update({
    where: { id: q1.id },
    data: {
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          schedule: { leadTimeMinutes: 60, slotLengthMinutes: 30, capacity: 4, openingHours: { mode: '24_7' } },
        },
      },
    },
  });
  await app.listen();
  const api = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  const publicCall = async (method, path, { body, headers = {} } = {}) => {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: {
        'x-salanca-intake-secret': process.env.FORM_INTAKE_SHARED_SECRET,
        'x-salanca-visitor-ip': '203.0.113.50',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };

  const config = await publicCall('GET', '/config?branch=Q1');
  assert.equal(config.status, 200);
  const date = config.body.branch.pickup.bookableTo;
  const slots = await publicCall('GET', `/slots?branch=Q1&date=${date}`);
  const slot = slots.body.items.find((item) => item.available);
  assert.ok(slot, 'an open slot exists');
  const cart = {
    branch: 'Q1',
    locale: 'vi',
    lines: [{ sellableUid: 'bun-bo', quantity: 2 }, { sellableUid: 'tra-dao', quantity: 1 }],
    receiveMethod: { kind: 'pickup', slot: { startsAt: slot.startsAt } },
  };
  const quote = await publicCall('POST', '/quote', { body: cart });
  assert.equal(quote.status, 200);
  const created = await publicCall('POST', '/orders', {
    body: {
      ...cart,
      contact: { name: 'Smoke', phone: '0901234567' },
      consent: { policyVersion: config.body.consentPolicyVersion, accepted: true },
      expectedCartHash: quote.body.cartHash,
      captchaToken: 'pass',
    },
    headers: { 'Idempotency-Key': `smoke-${randomUUID()}` },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const token = created.body.token;
  const code = created.body.order.code;

  const staff = await seedAdminHttpStaff(app, { scopes: { lan: { allLocations: false, locationRefs: ['Q1'] } } });
  try {
    const { lan } = staff.as;
    const inbox = await lan('GET', '/orders?tab=awaiting');
    const row = inbox.body.results.find((item) => item.code === code);
    assert.ok(row, 'the order is in the inbox');
    for (const to of ['preparing', 'ready']) {
      assert.equal((await lan('POST', `/orders/${row.id}/transition`, { to })).status, 200, to);
    }
    const handover = await lan('POST', `/orders/${row.id}/cash-handover`, { method: 'cash' });
    assert.equal(handover.status, 200);
    assert.equal(handover.body.collected, quote.body.totals.grandTotal);
  } finally {
    await staff.cleanup();
  }

  const view = await publicCall('GET', '/orders', { headers: { 'X-Order-Token': token } });
  assert.equal(view.body.order.status, 'completed');
  assert.equal(view.body.order.paymentStatus, 'paid');
  assert.deepEqual(
    view.body.order.steps.history.map((step) => step.status),
    ['placed', 'preparing', 'ready', 'delivered'],
  );
  console.log(`[ordering-test] smoke pickup: ${code} placed → preparing → ready → paid and delivered`);
});
