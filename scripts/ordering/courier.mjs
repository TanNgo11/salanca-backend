// Step 7: a courier sees only today's deliveries assigned to them. Cash handover
// and transition on someone else's order are 404 when the actor has no order.read.
// A branch reader with order.read can still hand over. Logs never print the address.
// Run: ORDERING_TEST_DATABASE=salanca_ordering_o7 node scripts/ordering/courier.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  cleanupStaff,
  seedAdminHttpStaff,
  seedBranches,
  seedMenu,
  seedStaff,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

if (!process.env.PORT || process.env.PORT === '1337') process.env.PORT = '15120';

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

// Test-only address. This file must not print it.
const ADDRESS = {
  communeCode: 'XT01002',
  line1: '12 Đường Bí Mật',
  recipientName: 'Người Thử',
  phone: '0901234567',
};

const idsOf = (body) =>
  (body?.orders ?? []).map((row) => row.id).sort((left, right) => left - right);

await withApp(async (app) => {
  const httpCleanups = [];
  let staff;
  try {
    await seedBranches(app);
    seedMenu(app);
    const plugin = app.plugin('ordering');
    const { order, transition } = services(app);
    const adminOrders = plugin.service('admin-orders');
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

    staff = await seedStaff(app);
    const lanCtx = { actor: staff.lan.actor };
    await app.listen();

    const couriers = await seedAdminHttpStaff(app, {
      actions: ['order.process', 'payment.record-cash'],
      scopes: {
        an: { allLocations: false, locationRefs: ['Q1'] },
        binh: { allLocations: false, locationRefs: ['Q1'] },
      },
    });
    httpCleanups.push(couriers);
    const aRef = `admin:${couriers.users.an.id}`;
    const bRef = `admin:${couriers.users.binh.id}`;

    const place = () =>
      order.createOrder(
        {
          idempotencyKey: randomUUID(),
          locationRef: 'Q1',
          locale: 'vi',
          lines: [{ sellableUid: 'bun-bo', quantity: 2 }],
          receiveMethod: { kind: 'delivery', address: ADDRESS },
          contact: { name: 'Khách test', phone: '+84900000001' },
          consent: { policyVersion: 'v1', channel: 'web-checkout' },
          origin: { kind: 'storefront' },
        },
        systemCtx,
      );

    const toReady = async (created) => {
      const orderId = created.order.order.id;
      const groupId = created.order.groups[0].id;
      await transition.transitionGroup({ orderId, groupId, to: 'preparing' }, systemCtx);
      await transition.transitionGroup({ orderId, groupId, to: 'ready' }, systemCtx);
      return { orderId, groupId };
    };

    const dispatch = async (created, assigneeRef) => {
      const ready = await toReady(created);
      await adminOrders.transition(
        ready.orderId,
        { to: 'out-for-delivery', assigneeRef },
        lanCtx,
      );
      return ready.orderId;
    };

    const readyCreated = await place();
    const ready = await toReady(readyCreated);
    const readyLeg = await app.db
      .query('plugin::ordering.fulfillment')
      .findOne({ where: { group: ready.groupId } });
    await app.db.query('plugin::ordering.fulfillment').update({
      where: { id: readyLeg.id },
      data: { assigneeRef: aRef },
    });

    const outA = await dispatch(await place(), aRef);
    const outB = await dispatch(await place(), bRef);
    const stale = await dispatch(await place(), aRef);
    await app.db.query('plugin::ordering.order').update({
      where: { id: stale },
      data: { businessDate: '1999-01-01' },
    });

    const reader = await seedAdminHttpStaff(app, {
      actions: ['order.read'],
      scopes: { xem: { allLocations: true, locationRefs: [] } },
    });
    httpCleanups.push(reader);
    const forbidden = await reader.as.xem('GET', '/courier/deliveries?view=active');
    assert.equal(forbidden.status, 403);

    const badView = await couriers.as.an('GET', '/courier/deliveries?view=nope');
    assert.equal(badView.status, 400);
    assert.equal(badView.body?.error?.code, 'VALIDATION_ERROR');

    const active = await couriers.as.an('GET', '/courier/deliveries?view=active');
    assert.equal(active.status, 200);
    assert.deepEqual(idsOf(active.body), [ready.orderId, outA].sort((left, right) => left - right));
    assert.equal(active.body.counts.active, 2);
    assert.equal(active.body.counts.done, 0);
    assert.equal(idsOf(active.body).includes(outB), false);
    assert.equal(idsOf(active.body).includes(stale), false);
    const byId = new Map(active.body.orders.map((row) => [row.id, row.status]));
    assert.equal(byId.get(ready.orderId), 'ready');
    assert.equal(byId.get(outA), 'out-for-delivery');
    const mine = active.body.orders.find((row) => row.id === outA);
    assert.equal(mine.due, 145000);
    assert.equal(typeof mine.address, 'string');
    assert.ok(mine.address.length > 0, 'assigned card includes an address');
    assert.equal(typeof mine.phone, 'string');

    const binh = await couriers.as.binh('GET', '/courier/deliveries?view=active');
    assert.equal(binh.status, 200);
    assert.deepEqual(idsOf(binh.body), [outB]);

    const deniedCash = await couriers.as.an('POST', `/orders/${outB}/cash-handover`, { method: 'cash' });
    assert.equal(deniedCash.status, 404);
    assert.equal(deniedCash.body?.error?.code, 'ORDER_NOT_FOUND');
    const deniedMove = await couriers.as.an('POST', `/orders/${outB}/transition`, {
      to: 'failed',
      reasonCode: 'unreachable',
    });
    assert.equal(deniedMove.status, 404);
    assert.equal(deniedMove.body?.error?.code, 'ORDER_NOT_FOUND');

    const started = await couriers.as.an('POST', `/orders/${ready.orderId}/transition`, {
      to: 'out-for-delivery',
      assigneeRef: aRef,
    });
    assert.equal(started.status, 200);

    const handed = await couriers.as.an('POST', `/orders/${outA}/cash-handover`, { method: 'cash' });
    assert.equal(handed.status, 200);

    const stillActive = await couriers.as.an('GET', '/courier/deliveries?view=active');
    assert.deepEqual(idsOf(stillActive.body), [ready.orderId]);
    assert.equal(stillActive.body.orders[0].status, 'out-for-delivery');
    const done = await couriers.as.an('GET', '/courier/deliveries?view=done');
    assert.equal(done.status, 200);
    assert.deepEqual(idsOf(done.body), [outA]);
    assert.equal(done.body.counts.done, 1);
    assert.equal(done.body.orders[0].status, 'delivered');

    const manager = await seedAdminHttpStaff(app, {
      actions: ['order.read', 'order.process', 'payment.record-cash'],
      scopes: { quanly: { allLocations: false, locationRefs: ['Q1'] } },
    });
    httpCleanups.push(manager);
    const managerHand = await manager.as.quanly('POST', `/orders/${outB}/cash-handover`, { method: 'cash' });
    assert.equal(managerHand.status, 200);

    console.log('[ordering-test] courier: own deliveries only; another courier handover is 404');
  } finally {
    for (const httpStaff of httpCleanups) await httpStaff.cleanup();
    if (staff) await cleanupStaff(app, staff);
  }
});
