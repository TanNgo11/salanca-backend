import assert from 'node:assert/strict';

import {
  basicOrderInput,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

withApp(async (app) => {
  const { order, transition } = services(app);
  await seedBranches(app);
  seedMenu(app);

  const created = await order.createOrder(basicOrderInput(), systemCtx);
  const orderId = created.order.order.id;
  const groupId = created.order.groups[0].id;

  for (const to of ['preparing', 'ready', 'delivered']) {
    await transition.transitionGroup({ orderId, groupId, to }, systemCtx);
  }
  let agg = await order.getOrder(orderId, systemCtx);
  assert.equal(agg.order.fulfillmentStatus, 'done');
  assert.equal(agg.order.status, 'open'); // terminal groups but nothing captured yet
  console.log('[ordering-test] awaiting-acceptance→preparing→ready→delivered; order still open (unpaid)');

  await assert.rejects(
    transition.transitionGroup({ orderId, groupId, to: 'preparing' }, systemCtx),
    (error) => error?.code === 'INVALID_TRANSITION',
  );
  console.log('[ordering-test] delivered→preparing → INVALID_TRANSITION');

  // Two parallel transitions race on the group row lock: exactly one wins.
  const raced = await order.createOrder(basicOrderInput(), systemCtx);
  const raceGroupId = raced.order.groups[0].id;
  const results = await Promise.allSettled([
    transition.transitionGroup(
      { orderId: raced.order.order.id, groupId: raceGroupId, to: 'preparing' },
      systemCtx,
    ),
    transition.transitionGroup(
      { orderId: raced.order.order.id, groupId: raceGroupId, to: 'preparing' },
      systemCtx,
    ),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter(
    (r) => r.status === 'rejected' && r.reason?.code === 'INVALID_TRANSITION',
  );
  assert.equal(ok.length, 1);
  assert.equal(rejected.length, 1);
  console.log('[ordering-test] parallel transitions → 1 ok, 1 INVALID_TRANSITION (row lock)');

  // cancelOrder releases holds and cancels every group.
  const held = await order.createOrder(
    basicOrderInput({
      holds: [
        {
          lineIndex: 0,
          resourceRef: 'slot:2026-10-11T09:00',
          quantity: 1,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        },
      ],
    }),
    systemCtx,
  );
  const canceled = await transition.cancelOrder(
    { orderId: held.order.order.id, reason: 'customer changed mind' },
    systemCtx,
  );
  assert.equal(canceled.order.status, 'canceled');
  assert.equal(canceled.order.fulfillmentStatus, 'canceled');
  assert.ok(
    canceled.holds.every((hold) => hold.releasedAt !== null && hold.releaseReason),
    'all holds released',
  );
  assert.ok(
    canceled.groups.every((group) => group.status === 'canceled'),
    'all groups canceled',
  );
  console.log('[ordering-test] cancelOrder → order/group canceled, holds released');

  // Customer cancel allowed from a customerCancellable state.
  const customer = await order.createOrder(basicOrderInput(), systemCtx);
  const customerCanceled = await transition.customerCancel(
    { orderId: customer.order.order.id, reason: 'changed mind' },
    systemCtx,
  );
  assert.equal(customerCanceled.order.status, 'canceled');
  console.log('[ordering-test] customerCancel from awaiting-acceptance → canceled');

  // Timeline/outbox evidence from the first lifecycle.
  const events = await app.db
    .query('plugin::ordering.order-event')
    .findMany({ where: { order: { id: orderId }, type: 'fulfillment-group.transitioned' } });
  assert.ok(events.length >= 3);
  // Every state in pickup-pay-on-pickup is public; hold releases stay staff-only.
  const deliveredEvent = events.find((event) => event.payload?.to === 'delivered');
  assert.equal(deliveredEvent.isPublic, true);
  const preparingEvent = events.find((event) => event.payload?.to === 'preparing');
  assert.equal(preparingEvent.isPublic, true);
  const holdEvents = await app.db
    .query('plugin::ordering.order-event')
    .findMany({ where: { order: { id: held.order.order.id }, type: 'hold.released' } });
  assert.ok(holdEvents.length >= 1);
  assert.ok(holdEvents.every((event) => event.isPublic === false));
  const outboxRows = await app.db
    .query('plugin::ordering.outbox')
    .findMany({ where: { aggregateId: String(orderId) } });
  const types = outboxRows.map((row) => row.type);
  assert.ok(types.includes('order.created'));
  assert.ok(types.includes('fulfillment-group.transitioned'));
  console.log('[ordering-test] timeline isPublic flags + outbox transition events verified');
});
