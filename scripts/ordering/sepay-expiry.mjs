// O4 step 9: a prepay order past paymentTimeoutMinutes expires and releases its hold.
// Money that arrives after that is order-closed and is not captured. Accept-then-pay
// starts the clock when the group enters awaiting-payment, not at placement.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { runPaymentExpiry } from '../../src/plugins/ordering/dist/server/src/jobs/payment-expiry.js';
import { basicOrderInput, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const sign = (secret, timestamp, rawBody) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

const MINUTE = 60_000;

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const branches = app.db.query('plugin::ordering.branch');
  const setTiming = async (paymentTiming) => {
    const q1 = await branches.findOne({ where: { code: 'Q1' } });
    await branches.update({
      where: { id: q1.id },
      data: {
        fulfillment: {
          pickup: {
            enabled: true,
            paymentTiming,
            paymentProviders: ['sepay'],
            paymentTimeoutMinutes: 15,
          },
        },
      },
    });
  };

  await setTiming('prepay');
  const { order, hold, transition } = services(app);
  const orders = app.db.query('plugin::ordering.order');
  const holds = app.db.query('plugin::ordering.hold');
  const place = () => order.createOrder(basicOrderInput(), systemCtx);
  const load = (orderId) => order.getOrder(orderId, systemCtx);
  const capturedOf = (aggregate) =>
    aggregate.payments.reduce((sum, payment) => sum + payment.capturedAmount, 0);

  const fresh = await place();
  const freshId = fresh.order.order.id;
  const kept = await runPaymentExpiry(app, { owner: 'expiry', now: new Date(Date.now() + MINUTE) });
  assert.equal(kept.ran, true);
  assert.equal(kept.expired, 0);
  assert.equal((await load(freshId)).groups[0].status, 'awaiting-payment');

  const late = await place();
  const lateId = late.order.order.id;
  const lateGroupId = late.order.groups[0].id;
  const lateCode = late.order.order.code;
  const lateTotal = late.order.order.totalAmount;
  await orders.update({
    where: { id: lateId },
    data: { placedAt: new Date(Date.now() - 16 * MINUTE) },
  });
  await hold.create(
    {
      orderId: lateId,
      groupId: lateGroupId,
      resourceRef: 'pay-slot',
      quantity: 1,
      expiresAt: new Date(Date.now() + 60 * MINUTE),
    },
    systemCtx,
  );
  const expired = await runPaymentExpiry(app, { owner: 'expiry-late' });
  assert.equal(expired.expired, 1);
  const lateOrder = await load(lateId);
  assert.equal(lateOrder.groups[0].status, 'expired');
  assert.equal(lateOrder.order.status, 'canceled');
  assert.equal(lateOrder.order.fulfillmentStatus, 'canceled');
  const holdRow = await holds.findOne({ where: { order: lateId } });
  assert.ok(holdRow.releasedAt, 'the slot hold must be released');
  assert.equal(holdRow.releaseReason, 'group-canceled');
  assert.equal((await load(freshId)).groups[0].status, 'awaiting-payment');

  const again = await runPaymentExpiry(app, { owner: 'expiry-again' });
  assert.equal(again.expired, 0);

  await app.listen();
  const secret = app.config.get('plugin::ordering').providers.payment.sepay.webhookSecret;
  const url = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering/webhooks/sepay`;
  const body = JSON.stringify({
    id: 97001,
    gateway: 'MBBank',
    transactionDate: '2026-10-11 12:00:00',
    accountNumber: '0123456789',
    content: `SLC${lateCode}`,
    transferType: 'in',
    transferAmount: lateTotal,
    referenceCode: 'FTEXP97001',
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-SePay-Timestamp': timestamp,
      'X-SePay-Signature': `sha256=${sign(secret, timestamp, body)}`,
    },
    body,
  });
  assert.equal(res.status, 200);
  const row = await app.db.query('plugin::ordering.payment-event').findOne({
    where: { providerTransactionId: '97001' },
  });
  assert.equal(row.reviewReason, 'order-closed');
  assert.equal(row.reviewStatus, 'needs-review');
  const afterPay = await load(lateId);
  assert.equal(afterPay.groups[0].status, 'expired');
  assert.equal(capturedOf(afterPay), 0);

  const clearFresh = await runPaymentExpiry(app, {
    owner: 'expiry-clear',
    now: new Date(Date.now() + 16 * MINUTE),
  });
  assert.equal(clearFresh.expired, 1);
  assert.equal((await load(freshId)).groups[0].status, 'expired');

  await setTiming('accept-then-pay');
  const accepted = await place();
  const acceptedId = accepted.order.order.id;
  await orders.update({
    where: { id: acceptedId },
    data: { placedAt: new Date(Date.now() - 30 * MINUTE) },
  });
  assert.equal((await load(acceptedId)).groups[0].status, 'awaiting-acceptance');
  const waiting = await runPaymentExpiry(app, { owner: 'expiry-accept' });
  assert.equal(waiting.expired, 0);
  assert.equal((await load(acceptedId)).groups[0].status, 'awaiting-acceptance');

  await transition.transitionGroup(
    { orderId: acceptedId, groupId: accepted.order.groups[0].id, to: 'awaiting-payment' },
    systemCtx,
  );
  const justEntered = await runPaymentExpiry(app, { owner: 'expiry-entered' });
  assert.equal(justEntered.expired, 0);
  assert.equal((await load(acceptedId)).groups[0].status, 'awaiting-payment');

  const later = await runPaymentExpiry(app, {
    owner: 'expiry-entered-late',
    now: new Date(Date.now() + 16 * MINUTE),
  });
  assert.equal(later.expired, 1);
  assert.equal((await load(acceptedId)).groups[0].status, 'expired');

  console.log('[ordering-test] sepay expiry: prepay, late money, accept-then-pay');
});
