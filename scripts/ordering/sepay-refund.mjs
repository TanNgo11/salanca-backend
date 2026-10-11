// O4 step 10: a SePay refund stays pending until staff record the outbound reference.
// paymentStatus moves only then. No call to SePay.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { basicOrderInput, seedAdminHttpStaff, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const sign = (secret, timestamp, rawBody) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

withApp(async (app) => {
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
          paymentTiming: 'prepay',
          paymentProviders: ['sepay'],
          paymentTimeoutMinutes: 15,
        },
      },
    },
  });

  await app.listen();
  const secret = app.config.get('plugin::ordering').providers.payment.sepay.webhookSecret;
  const url = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering/webhooks/sepay`;
  const postTransfer = async (payload) => {
    const body = JSON.stringify(payload);
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
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const http = await seedAdminHttpStaff(app, {
    scopes: {
      lan: { allLocations: false, locationRefs: ['Q1'] },
      q3: { allLocations: false, locationRefs: ['Q3'] },
    },
  });
  const { order } = services(app);
  const refunds = () => app.db.query('plugin::ordering.refund');
  const logs = () => app.db.query('plugin::ordering.admin-change-log');
  const events = () => app.db.query('plugin::ordering.order-event');

  try {
    const placed = await order.createOrder(basicOrderInput(), systemCtx);
    const orderId = placed.order.order.id;
    const total = placed.order.order.totalAmount;
    const half = total / 2;
    const code = placed.order.order.code;
    assert.equal(half * 2, total);
    const paid = await postTransfer({
      id: 98001,
      transferType: 'in',
      transferAmount: total,
      accountNumber: '0123456789',
      content: `SLC${code}`,
    });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    const before = await order.getOrder(orderId, systemCtx);
    assert.equal(before.order.paymentStatus, 'paid');
    assert.equal(before.groups[0].status, 'awaiting-acceptance');

    const badMethod = await http.as.lan('POST', `/orders/${orderId}/refunds`, {
      method: 'card',
      amount: half,
      reason: 'không hợp lệ',
    });
    assert.equal(badMethod.status, 400);
    assert.equal(badMethod.body.error.code, 'VALIDATION_ERROR');
    const zero = await http.as.lan('POST', `/orders/${orderId}/refunds`, {
      method: 'bank',
      amount: 0,
      reason: 'không tiền',
    });
    assert.equal(zero.status, 400);
    assert.equal(zero.body.error.code, 'VALIDATION_ERROR');
    const noReason = await http.as.lan('POST', `/orders/${orderId}/refunds`, {
      method: 'bank',
      amount: half,
      reason: '   ',
    });
    assert.equal(noReason.status, 400);
    const denied = await http.as.q3('POST', `/orders/${orderId}/refunds`, {
      method: 'bank',
      amount: half,
      reason: 'ngoài scope',
    });
    assert.equal(denied.status, 404);
    assert.equal(denied.body.error.code, 'ORDER_NOT_FOUND');

    const first = await http.as.lan('POST', `/orders/${orderId}/refunds`, {
      method: 'bank',
      amount: half,
      reason: 'khách hủy một phần',
      idempotencyKey: 'refund-half-1',
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.order.paymentStatus, 'paid');
    assert.equal(first.body.order.status, 'open');
    assert.equal(first.body.totals.refunded, 0);
    assert.equal(first.body.payments[0].refundedAmount, 0);
    assert.equal(first.body.refunds.length, 1);
    assert.equal(first.body.refunds[0].status, 'pending');
    assert.equal(first.body.refunds[0].referenceMasked, null);
    const firstId = first.body.refunds[0].id;

    const replay = await http.as.lan('POST', `/orders/${orderId}/refunds`, {
      method: 'bank',
      amount: half,
      reason: 'khách hủy một phần',
      idempotencyKey: 'refund-half-1',
    });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.refunds.length, 1);
    const createLogs = await logs().findMany({ where: { action: 'refund.create' } });
    assert.equal(createLogs.length, 1);

    const second = await http.as.lan('POST', `/orders/${orderId}/refunds`, {
      method: 'bank',
      amount: half,
      reason: 'khách hủy phần còn',
      idempotencyKey: 'refund-half-2',
    });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.order.paymentStatus, 'paid');
    assert.equal(second.body.payments[0].refundedAmount, 0);
    assert.equal(second.body.refunds.length, 2);
    const secondId = second.body.refunds.find((row) => row.id !== firstId).id;
    assert.equal(second.body.refunds.every((row) => row.status === 'pending'), true);

    const over = await http.as.lan('POST', `/orders/${orderId}/refunds`, {
      method: 'bank',
      amount: 1,
      reason: 'vượt số đã thu',
      idempotencyKey: 'refund-over',
    });
    assert.equal(over.status, 409);
    assert.equal(over.body.error.code, 'REFUND_EXCEEDS_CAPTURED');
    assert.equal((await refunds().findMany({})).length, 2);

    const deniedSettle = await http.as.q3('POST', `/refunds/${firstId}/settle`, { reference: 'FTREF1001' });
    assert.equal(deniedSettle.status, 404);
    const badRef = await http.as.lan('POST', `/refunds/${firstId}/settle`, { reference: 'có dấu' });
    assert.equal(badRef.status, 400);
    assert.equal(badRef.body.error.code, 'VALIDATION_ERROR');

    const settled = await http.as.lan('POST', `/refunds/${firstId}/settle`, { reference: 'FTREF1001' });
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    assert.equal(settled.body.order.paymentStatus, 'partially-refunded');
    assert.equal(settled.body.order.status, 'open');
    assert.equal(settled.body.group.status, 'awaiting-acceptance');
    assert.equal(settled.body.totals.refunded, half);
    assert.equal(settled.body.payments[0].refundedAmount, half);
    const settledRow = settled.body.refunds.find((row) => row.id === firstId);
    assert.equal(settledRow.status, 'settled');
    assert.equal(settledRow.referenceMasked, 'FTRE•••1001');
    const settledJson = JSON.stringify(settled.body);
    assert.equal(settledJson.includes('FTREF1001'), false);
    assert.equal(settledJson.includes('0123456789'), false);
    assert.equal(settled.body.refunds.find((row) => row.id === secondId).status, 'pending');

    const again = await http.as.lan('POST', `/refunds/${firstId}/settle`, { reference: 'FTREF1001' });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.payments[0].refundedAmount, half);
    const otherRef = await http.as.lan('POST', `/refunds/${firstId}/settle`, { reference: 'FTREF9999' });
    assert.equal(otherRef.status, 400);
    assert.equal(otherRef.body.error.code, 'VALIDATION_ERROR');
    const settleLogs = await logs().findMany({
      where: { action: 'refund.settle', entityId: String(firstId) },
    });
    assert.equal(settleLogs.length, 1);
    assert.equal(JSON.stringify(settleLogs[0].changes).includes('FTREF1001'), true);

    const timeline = await events().findMany({ where: { order: orderId } });
    const refundEvents = timeline.filter((row) => row.type === 'refund.pending' || row.type === 'refund.settled');
    assert.equal(JSON.stringify(refundEvents).includes('FTREF1001'), false);
    assert.equal(refundEvents.some((row) => row.type === 'refund.settled'), true);

    const duplicate = await http.as.lan('POST', `/refunds/${secondId}/settle`, { reference: 'FTREF1001' });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.error.code, 'VALIDATION_ERROR');
    const still = await http.as.lan('GET', `/orders/${orderId}`);
    assert.equal(still.body.payments[0].refundedAmount, half);
    assert.equal(still.body.refunds.find((row) => row.id === secondId).status, 'pending');

    const rest = await http.as.lan('POST', `/refunds/${secondId}/settle`, {
      reference: 'FTREF1002',
      settledAt: '2026-10-11T08:00:00.000Z',
    });
    assert.equal(rest.status, 200, JSON.stringify(rest.body));
    assert.equal(rest.body.order.paymentStatus, 'refunded');
    assert.equal(rest.body.payments[0].refundedAmount, total);
    assert.equal(rest.body.order.status, 'open');
    assert.equal(rest.body.group.status, 'awaiting-acceptance');
    assert.equal(JSON.stringify(rest.body).includes('FTREF1002'), false);
    const stored = await refunds().findOne({ where: { id: secondId } });
    assert.equal(stored.providerReference, 'FTREF1002');
    assert.equal(JSON.stringify(stored).includes('0123456789'), false);

    const noneLeft = await http.as.lan('POST', `/orders/${orderId}/refunds`, {
      method: 'bank',
      amount: 1,
      reason: 'đã hoàn hết',
      idempotencyKey: 'refund-none',
    });
    assert.equal(noneLeft.status, 409);
    assert.equal(noneLeft.body.error.code, 'REFUND_EXCEEDS_CAPTURED');

    console.log('[ordering-test] sepay refund: pending, settle, paymentStatus');
  } finally {
    await http.cleanup();
  }
});
