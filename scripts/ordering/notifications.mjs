import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import { seedBranches, seedMenu, seedStaff, cleanupStaff, systemCtx, withApp } from './_harness.mjs';

// O3 step 11: emails from the outbox — staff "đơn mới" at the branch email, customer steps in
// the order's language with the #t= link, accept-and-delay sends the new time, notifyCustomer
// false sends nothing, a dispatcher re-run or handler retry never sends twice, a send failure is
// retried, and the delivery log never holds an address.
withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const plugin = app.plugin('ordering');
  const capture = plugin.service('registry').notificationProvider('email');
  const branchRows = app.db.query('plugin::ordering.branch');
  const q1 = await branchRows.findOne({ where: { code: 'Q1' } });
  await branchRows.update({
    where: { id: q1.id },
    data: {
      email: 'q1-staff@example.invalid',
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          schedule: { leadTimeMinutes: 30, openingHours: { mode: '24_7' } },
        },
      },
    },
  });
  const staff = await seedStaff(app);
  const lanCtx = { actor: staff.lan.actor };
  const dispatch = () => runOutboxDispatcher(app, { owner: `test:${process.pid}` });
  const place = async (overrides = {}) =>
    plugin.service('order').createOrder(
      {
        idempotencyKey: randomUUID(),
        locationRef: 'Q1',
        locale: 'en',
        lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
        receiveMethod: { kind: 'pickup', locationRef: 'Q1' },
        pickup: { asap: true },
        contact: { name: 'Ngoc', phone: '0901234567', email: 'guest@example.invalid' },
        consent: { policyVersion: 'v1', channel: 'web-checkout' },
        origin: { kind: 'storefront' },
        ...overrides,
      },
      systemCtx,
    );

  try {
    const first = await place();
    await dispatch();
    const placed = capture.sent.splice(0);
    assert.deepEqual(placed.map((mail) => [mail.template, mail.to]).sort(), [
      ['customer.order-placed', 'guest@example.invalid'],
      ['staff.order-created', 'q1-staff@example.invalid'],
    ]);
    const receipt = placed.find((mail) => mail.template === 'customer.order-placed');
    assert.match(receipt.subject, /^Order SLC-\d+ received$/, 'English order → English email');
    assert.ok(receipt.text.includes(`#t=${first.publicToken}`), 'customer link carries the token after #');
    assert.match(placed.find((mail) => mail.template === 'staff.order-created').subject, /^Đơn mới/);

    // --- Accept and delay → "new pickup time" with the ready time ----------------------------
    const adminOrders = plugin.service('admin-orders');
    await adminOrders.transition(first.order.order.id, { to: 'preparing', delayMinutes: 20 }, lanCtx);
    await dispatch();
    const delayed = capture.sent.splice(0);
    assert.deepEqual(delayed.map((mail) => mail.template), ['customer.order-delayed']);
    assert.ok(delayed[0].text.includes('Estimated ready:'));

    // --- notifyCustomer false: no email ---------------------------------------------------------
    await adminOrders.transition(first.order.order.id, { to: 'ready', notifyCustomer: false }, lanCtx);
    await dispatch();
    assert.equal(capture.sent.length, 0, 'staff chose not to notify');

    // --- Re-run and handler retry never send twice -------------------------------------------
    await dispatch();
    assert.equal(capture.sent.length, 0, 'second dispatcher run sends nothing');
    const events = await app.db.query('plugin::ordering.outbox').findMany({ where: { type: 'order.created' } });
    const notification = plugin.service('notification');
    await notification.onOrderPlaced({ ...events[0], id: String(events[0].id) });
    assert.equal(capture.sent.length, 0, 'replaying a delivered event sends nothing');

    // --- Rejected with a reason in the customer's language -------------------------------------
    const second = await place();
    await dispatch();
    capture.sent.splice(0);
    await adminOrders.transition(second.order.order.id, { to: 'rejected', reasonCode: 'out-of-stock' }, lanCtx);
    capture.failNext = 1;
    const failedRun = await dispatch();
    assert.equal(capture.sent.length, 0);
    assert.ok(failedRun.retried >= 1, 'a failed send is retried by the outbox');
    const failedRow = await app.db
      .query('plugin::ordering.notification-delivery')
      .findOne({ where: { template: 'customer.order-rejected' } });
    assert.equal(failedRow.status, 'failed');
    const rejectedEvent = (
      await app.db.query('plugin::ordering.outbox').findMany({ where: { type: 'fulfillment-group.transitioned' } })
    ).find((row) => row.payload.orderId === second.order.order.id && row.payload.to === 'rejected');
    await notification.onGroupTransitioned({ ...rejectedEvent, id: String(rejectedEvent.id) });
    await notification.onGroupTransitioned({ ...rejectedEvent, id: String(rejectedEvent.id) });
    assert.deepEqual(capture.sent.map((mail) => mail.template), ['customer.order-rejected'], 'retry sends once');
    assert.ok(capture.sent[0].text.includes('Reason: Out of stock'));

    // --- Delivery legs: their own wording, never pickup phrases --------------------------------
    await branchRows.update({
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
            zones: [
              {
                code: 'near',
                label: 'Gần',
                priority: 10,
                match: { kind: 'commune', communeCodes: ['XT01001', 'XT01002'] },
                rules: [{ when: 'any', fee: 0 }],
                minOrderAmount: 0,
                extraLeadTimeMinutes: 30,
              },
            ],
          },
        },
      },
    });
    const deliveryOrder = await place({
      lines: [{ sellableUid: 'bun-bo', quantity: 2 }],
      receiveMethod: { kind: 'delivery', address: {
        communeCode: 'XT01002', line1: '12 Đường Bí Mật', recipientName: 'Người Thử', phone: '0901234567',
      } },
    });
    await dispatch();
    capture.sent.splice(0);
    const dId = deliveryOrder.order.order.id;
    const lanRef = `admin:${staff.lan.user.id}`;
    await adminOrders.transition(dId, { to: 'preparing' }, lanCtx);
    await adminOrders.transition(dId, { to: 'ready' }, lanCtx);
    await dispatch();
    assert.deepEqual(
      capture.sent.splice(0).map((mail) => mail.template),
      ['customer.order-accepted'],
      'the first "ready" of a delivery leg mails nothing — the dispatch mail follows',
    );
    await adminOrders.transition(dId, { to: 'out-for-delivery', assigneeRef: lanRef }, lanCtx);
    await dispatch();
    let mails = capture.sent.splice(0);
    assert.deepEqual(mails.map((mail) => mail.template), ['customer.delivery-out']);
    assert.match(mails[0].subject, /is on its way/);
    assert.ok(!mails[0].text.includes('pickup'), 'no pickup wording on a delivery mail');
    await adminOrders.transition(dId, { to: 'failed', reasonCode: 'unreachable' }, lanCtx);
    await dispatch();
    mails = capture.sent.splice(0);
    assert.deepEqual(mails.map((mail) => mail.template), ['customer.delivery-failed']);
    assert.ok(mails[0].text.includes('Reason: We could not reach you'));
    await adminOrders.transition(dId, { to: 'ready' }, lanCtx);
    await dispatch();
    assert.deepEqual(capture.sent.splice(0).map((mail) => mail.template), ['customer.delivery-retry']);
    await adminOrders.transition(dId, { to: 'out-for-delivery', assigneeRef: lanRef }, lanCtx);
    await adminOrders.cashHandover(dId, {}, lanCtx);
    await dispatch();
    mails = capture.sent.splice(0);
    assert.deepEqual(
      mails.map((mail) => mail.template).sort(),
      ['customer.delivery-delivered', 'customer.delivery-out'].sort(),
    );
    assert.ok(
      mails.every((mail) => !mail.text.includes('ready for pickup')),
      'pickup phrases never appear on a delivery order',
    );

    // --- Delivery log: hashes only ------------------------------------------------------------
    const rows = await app.db.query('plugin::ordering.notification-delivery').findMany({});
    assert.ok(rows.length >= 4);
    assert.ok(rows.every((row) => !JSON.stringify(row).includes('@')), 'no address in the log');
    assert.ok(rows.every((row) => /^[0-9a-f]{64}$/.test(row.recipientHash)));
    console.log('[ordering-test] notifications: staff + customer emails, language, link, delay, opt-out, dedupe, retry verified');
  } finally {
    await cleanupStaff(app, staff);
  }
});
