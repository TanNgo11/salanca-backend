// O5 acceptance smoke (spec "node scripts/smoke-ordering-delivery.mjs"): a delivery order on the
// ordering test database is quoted over the public API, placed, assigned to an in-scope courier,
// then driven ready → out-for-delivery → delivered with cash collected at the door. Never calls a
// real carrier and never touches the dev or production DB.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.FORM_INTAKE_SHARED_SECRET ||= 'smoke-ordering-secret';

const { basicOrderInput, seedBranches, seedMenu, seedStaff, services, systemCtx, withApp } = await import(
  './ordering/_harness.mjs'
);

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

// Test-only address; logs never print it (harness rule).
const ADDRESS = {
  communeCode: 'XT01002',
  line1: '12 Đường Bí Mật',
  recipientName: 'Người Thử',
  phone: '0901234567',
};

await withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const staff = await seedStaff(app);
  const lanCtx = { actor: staff.lan.actor };
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
          schedule: { leadTimeMinutes: 30, openingHours: { mode: '24_7' } },
        },
        delivery: {
          enabled: true,
          orderTiming: 'both',
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          minOrderAmount: 0,
          schedule: { leadTimeMinutes: 60, slotLengthMinutes: 15, capacity: 8, openingHours: { mode: '24_7' } },
          zones: [zone],
        },
      },
    },
  });
  await app.listen();

  const api = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  const headers = {
    'Content-Type': 'application/json',
    'x-salanca-intake-secret': process.env.FORM_INTAKE_SHARED_SECRET,
    'x-salanca-visitor-ip': '203.0.113.51',
  };
  const post = async (path, body, extra = {}) => {
    const res = await fetch(`${api}${path}`, {
      method: 'POST',
      headers: { ...headers, ...extra },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  // The public quote prices the leg before checkout — fee + catalog-resolved snapshot.
  const quote = await post('/quote', {
    branch: 'Q1',
    locale: 'vi',
    lines: [{ sellableUid: 'bun-bo', quantity: 2 }],
    receiveMethod: { kind: 'delivery', address: ADDRESS },
    payment: { providerCode: 'cash' },
  });
  assert.equal(quote.status, 200);
  const subtotal = quote.body.totals.subtotal;
  const fee = subtotal < 100000 ? null : subtotal < 300000 ? 15000 : 0;
  assert.ok(fee !== null, 'fixture cart is above the zone minimum');
  assert.equal(quote.body.totals.fulfillmentTotal, fee, 'delivery fee lands in the quote totals');

  const { order, adminOrders } = { order: services(app).order, adminOrders: app.plugin('ordering').service('admin-orders') };
  const placed = await order.createOrder(
    basicOrderInput({
      lines: [{ sellableUid: 'bun-bo', quantity: 2 }],
      receiveMethod: { kind: 'delivery', address: ADDRESS },
    }),
    systemCtx,
  );
  const orderId = placed.order.order.id;
  const group = placed.order.groups[0];
  assert.equal(group.workflowName, 'delivery-pay-on-delivery');
  assert.equal(placed.order.order.fulfillmentAmount, fee);

  const transition = app.plugin('ordering').service('transition');
  await transition.transitionGroup({ orderId, groupId: group.id, to: 'preparing' }, systemCtx);
  await transition.transitionGroup({ orderId, groupId: group.id, to: 'ready' }, systemCtx);
  await adminOrders.transition(orderId, { to: 'out-for-delivery', assigneeRef: `admin:${staff.lan.user.id}` }, lanCtx);
  const handover = await adminOrders.cashHandover(orderId, {}, lanCtx);

  assert.equal(handover.detail.order.paymentStatus, 'paid');
  assert.equal(handover.detail.order.status, 'completed');
  const leg = await app.db.query('plugin::ordering.fulfillment').findOne({ where: { group: group.id } });
  assert.equal(leg.status, 'delivered');
  assert.equal(leg.assigneeRef, `admin:${staff.lan.user.id}`);
  assert.ok(leg.shippedAt && leg.deliveredAt, 'the leg stamps departure and arrival');
  assert.equal(leg.addressSnapshot.wardCode, 'XT01002', 'the snapshot resolves the commune from the catalog');

  // Staff summary: the delivery board's list reflects the finished leg outside the three tabs.
  const board = await adminOrders.list({ receive: 'delivery', tab: 'out', branch: 'Q1' }, lanCtx);
  assert.equal(board.results.every((row) => row.id !== orderId), true, 'delivered legs leave the board');
  const couriers = await app.plugin('ordering').service('delivery-assignment').assignableStaff('Q1', lanCtx);
  assert.ok(couriers.some((member) => member.ref === `admin:${staff.lan.user.id}`));

  console.log(`[ordering-test] smoke delivery: ${placed.order.order.code} quoted ${fee}, delivered by lan with cash at the door`);
});
