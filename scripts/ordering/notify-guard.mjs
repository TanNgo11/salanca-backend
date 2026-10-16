import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import { cleanupStaff, seedBranches, seedMenu, seedStaff, systemCtx, withApp } from './_harness.mjs';

// R1a: with `notifications.mode = allowlist`, every delivery path (outbox, OTP, staff test-send,
// direct provider call) reaches only the configured recipients, records `skipped` with reason
// `not-allowlisted`, and never spends a paid-message slot. Default `live` is untouched (proved by
// the other notification scripts staying green without expectation edits).
withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const plugin = app.plugin('ordering');
  const registry = plugin.service('registry');
  const capture = registry.notificationProvider('email');
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
  const deliveries = () => app.db.query('plugin::ordering.notification-delivery');
  const dispatch = () => runOutboxDispatcher(app, { owner: `guard:${process.pid}` });
  const place = (overrides) =>
    plugin.service('order').createOrder(
      {
        idempotencyKey: randomUUID(),
        locationRef: 'Q1',
        locale: 'en',
        lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
        receiveMethod: { kind: 'pickup', locationRef: 'Q1' },
        pickup: { asap: true },
        consent: { policyVersion: 'v1', channel: 'web-checkout' },
        origin: { kind: 'storefront' },
        ...overrides,
      },
      systemCtx,
    );
  const setAllowlist = (allowlist) => {
    app.config.set('plugin::ordering.notifications.mode', 'allowlist');
    app.config.set('plugin::ordering.notifications.allowlist', allowlist);
  };
  const rowsFor = async (orderId) => deliveries().findMany({ where: { orderId } });

  try {
    // --- A: recipients outside the list are skipped, nothing is sent ------------------------
    setAllowlist(['allowed@example.invalid']);
    capture.sent.splice(0);
    const blocked = await place({
      contact: { name: 'Khách A', phone: '0901234567', email: 'guest@example.invalid' },
    });
    await dispatch();
    const blockedRows = await rowsFor(blocked.order.order.id);
    const blockedCustomer = blockedRows.find((row) => row.template === 'customer.order-placed');
    const blockedStaff = blockedRows.find((row) => row.template === 'staff.order-created');
    assert.equal(blockedCustomer.status, 'skipped');
    assert.equal(blockedCustomer.lastError, 'not-allowlisted');
    assert.equal(blockedStaff.status, 'skipped');
    assert.equal(blockedStaff.lastError, 'not-allowlisted');
    assert.equal(capture.sent.length, 0, 'no mail reaches a non-allowlisted recipient');

    // --- B: adding the customer to the list lets the mail through ---------------------------
    setAllowlist(['allowed@example.invalid', 'guest@example.invalid']);
    capture.sent.splice(0);
    const allowedOrder = await place({
      contact: { name: 'Khách B', phone: '0901234567', email: 'guest@example.invalid' },
    });
    await dispatch();
    const allowedRows = await rowsFor(allowedOrder.order.order.id);
    const allowedCustomer = allowedRows.find((row) => row.template === 'customer.order-placed');
    assert.equal(allowedCustomer.status, 'sent');
    assert.ok(
      capture.sent.some((mail) => mail.template === 'customer.order-placed'),
      'an allowlisted customer receives the mail',
    );

    // --- C: a direct provider call is blocked by the proxy ----------------------------------
    const beforeDirect = capture.sent.length;
    let blockedError = null;
    try {
      await registry.notificationProvider('email').send({
        recipient: { email: 'x@other.invalid' },
        template: 'customer.order-placed',
        data: {},
      });
    } catch (error) {
      blockedError = error;
    }
    assert.equal(blockedError?.code, 'NOTIFICATION_BLOCKED');
    assert.equal(capture.sent.length, beforeDirect, 'a blocked send never reaches the provider');

    // --- D: OTP to a non-allowlisted address stays a plain {challengeId} --------------------
    capture.sent.splice(0);
    const otp = await plugin
      .service('customer-auth')
      .requestOtp({ channel: 'email', target: 'nobody@example.invalid' }, systemCtx);
    assert.ok(typeof otp.challengeId === 'string' && otp.challengeId !== '');
    const otpRow = await deliveries().findOne({ where: { template: 'customer.otp' } });
    assert.equal(otpRow.status, 'skipped');
    assert.equal(otpRow.lastError, 'not-allowlisted');
    assert.equal(capture.sent.length, 0, 'no OTP mail reaches a non-allowlisted address');

    // --- E: a blocked paid-channel recipient does not spend a daily slot --------------------
    registry.registerNotificationProvider('sms', {
      send: async () => ({ providerMessageId: 'fake-sms' }),
    });
    const channels = plugin.service('notification-channel');
    await channels.put('customer.order-placed', { channels: ['sms'] }, systemCtx);
    app.config.set('plugin::ordering.notifications.dailyLimit', 1);
    setAllowlist(['allowed@example.invalid']);
    capture.sent.splice(0);
    const paidOrder = await place({ contact: { name: 'Khách E', phone: '0909999999' } });
    await dispatch();
    const smsRow = (await rowsFor(paidOrder.order.order.id)).find((row) => row.channel === 'sms');
    assert.equal(smsRow.status, 'skipped');
    assert.equal(smsRow.lastError, 'not-allowlisted');
    assert.equal(
      await channels.reservePaidSend(),
      true,
      'the paid budget was not consumed by a blocked recipient',
    );

    console.log('[ordering-test] notify-guard: allowlist mode blocks all paths and keeps the budget');
  } finally {
    await cleanupStaff(app, staff);
  }
});
