// O4 step 13: a staff payment link opens only the QR page and can extend the payment
// window. Cancelling part of a paid transfer stays pending until the bank reference
// is recorded. A line cancel whose money is already reserved still cancels the units.
// No call to SePay.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.FORM_INTAKE_SHARED_SECRET = 'sepay-link-test-secret';

import { runPaymentExpiry } from '../../src/plugins/ordering/dist/server/src/jobs/payment-expiry.js';
import { basicOrderInput, seedAdminHttpStaff, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const sign = (secret, timestamp, rawBody) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

const tokenOf = (url) => {
  const match = String(url).match(/#p=([A-Za-z0-9_-]{43})/);
  assert.ok(match, 'payment url must carry a #p= token');
  return match[1];
};

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
  const api = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  const webhookUrl = `${api}/webhooks/sepay`;
  const store = app.store({ type: 'plugin', name: 'ordering' });
  const postTransfer = async (payload) => {
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await fetch(webhookUrl, {
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
  const publicCall = async (method, path, token, body) => {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: {
        'X-Order-Token': token,
        'x-salanca-intake-secret': process.env.FORM_INTAKE_SHARED_SECRET,
        'x-salanca-visitor-ip': '203.0.113.60',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
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
  const orders = app.db.query('plugin::ordering.order');
  // Plugin store survives the ordering-table reset, so a previous run's link would replay.
  const core = app.db.query('strapi::core-store');
  const storedKeys = await core.findMany({});
  for (const row of storedKeys) {
    if (typeof row.key === 'string' && row.key.includes('plugin_ordering_payment-')) {
      await core.delete({ where: { id: row.id } });
    }
  }

  try {
    const placed = await order.createOrder(basicOrderInput(), systemCtx);
    const orderId = placed.order.order.id;
    const code = placed.order.order.code;
    const total = placed.order.order.totalAmount;
    const orderToken = placed.publicToken;
    assert.equal(placed.order.groups[0].status, 'awaiting-payment');

    const created = await http.as.lan('POST', `/orders/${orderId}/payment-link`);
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.replayed, false);
    assert.ok(String(created.body.url).includes('#p='));
    assert.equal(typeof created.body.expiresAt, 'string');
    const payToken = tokenOf(created.body.url);
    assert.notEqual(payToken, orderToken);

    const byLink = await publicCall('GET', '/orders/payment', payToken);
    assert.equal(byLink.status, 200, JSON.stringify(byLink.body));
    assert.equal(byLink.body.payment.due, total);
    assert.equal(byLink.body.payment.presentation.memo, `SLC${code}`);
    assert.equal(byLink.body.payment.presentation.bankAccount.accountNumber, '0123456789');
    assert.ok(String(byLink.body.payment.presentation.qr).startsWith('data:image/svg+xml,'));

    const view = await publicCall('GET', '/orders', payToken);
    assert.equal(view.status, 401);
    assert.equal(view.body.error.code, 'ORDER_TOKEN_INVALID');
    const cancel = await publicCall('POST', '/orders/cancel', payToken, { reason: 'không được' });
    assert.equal(cancel.status, 401);
    assert.equal(cancel.body.error.code, 'ORDER_TOKEN_INVALID');

    const byOrder = await publicCall('GET', '/orders/payment', orderToken);
    assert.equal(byOrder.status, 200);
    assert.ok(byOrder.body.payment.presentation);

    const again = await http.as.lan('POST', `/orders/${orderId}/payment-link`);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.replayed, true);
    assert.equal(again.body.url, created.body.url);

    const denied = await http.as.q3('POST', `/orders/${orderId}/payment-link`);
    assert.equal(denied.status, 404);
    assert.equal(denied.body.error.code, 'ORDER_NOT_FOUND');

    const detail = await http.as.lan('GET', `/orders/${orderId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.paymentLink.expiresAt, created.body.expiresAt);
    assert.equal(JSON.stringify(detail.body).includes(payToken), false);

    const linkKey = `payment-link:${orderId}`;
    const storedLink = await store.get({ key: linkKey });
    await store.set({
      key: linkKey,
      value: { ...storedLink, expiresAt: new Date(Date.now() - 1000).toISOString() },
    });
    const expiredLink = await publicCall('GET', '/orders/payment', payToken);
    assert.equal(expiredLink.status, 401);
    assert.equal(expiredLink.body.error.code, 'ORDER_TOKEN_INVALID');
    const stillOpen = await publicCall('GET', '/orders/payment', orderToken);
    assert.equal(stillOpen.status, 200);
    assert.ok(stillOpen.body.payment.presentation);

    const renewed = await http.as.lan('POST', `/orders/${orderId}/payment-link`);
    assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
    assert.equal(renewed.body.replayed, false);
    assert.notEqual(renewed.body.url, created.body.url);
    const deadline = await store.get({ key: `payment-deadline:${orderId}` });
    assert.equal(typeof deadline, 'string');
    assert.ok(deadline >= renewed.body.expiresAt);
    const renewedView = await publicCall('GET', '/orders/payment', tokenOf(renewed.body.url));
    assert.equal(renewedView.status, 200, JSON.stringify(renewedView.body));
    assert.ok(renewedView.body.payment.presentation);

    await orders.update({
      where: { id: orderId },
      data: { placedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    const kept = await runPaymentExpiry(app, { owner: 'link-keep', now: new Date() });
    assert.equal(kept.ran, true);
    assert.equal(kept.expired, 0);
    assert.equal((await order.getOrder(orderId, systemCtx)).groups[0].status, 'awaiting-payment');
    const killed = await runPaymentExpiry(app, {
      owner: 'link-kill',
      now: new Date(new Date(deadline).getTime() + 1000),
    });
    assert.equal(killed.expired, 1);
    const afterExpiry = await publicCall('GET', '/orders/payment', orderToken);
    assert.equal(afterExpiry.status, 200);
    assert.equal(afterExpiry.body.payment.presentation, null);

    const paid = await order.createOrder(basicOrderInput(), systemCtx);
    const paidId = paid.order.order.id;
    const paidCode = paid.order.order.code;
    const paidTotal = paid.order.order.totalAmount;
    const goiCuon = paid.order.lines.find((line) => line.sellableUid === 'goi-cuon');
    const traDao = paid.order.lines.find((line) => line.sellableUid === 'tra-dao');
    const transferred = await postTransfer({
      id: 99101,
      transferType: 'in',
      transferAmount: paidTotal,
      accountNumber: '0123456789',
      content: `SLC${paidCode}`,
      referenceCode: 'FTLINK99101',
    });
    assert.equal(transferred.status, 200, JSON.stringify(transferred.body));
    const beforeCancel = await order.getOrder(paidId, systemCtx);
    assert.equal(beforeCancel.order.paymentStatus, 'paid');
    assert.equal(beforeCancel.groups[0].status, 'awaiting-acceptance');

    const first = await http.as.lan('POST', `/orders/${paidId}/lines/${goiCuon.id}/cancel`, {
      quantity: 1,
      reason: 'khách bớt gỏi cuốn',
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.ok(first.body.refundAmount > 0);
    assert.equal(first.body.refundShortfall, 0);
    assert.equal(first.body.detail.order.paymentStatus, 'paid');
    assert.equal(first.body.detail.order.status, 'open');
    assert.equal(first.body.detail.group.status, 'awaiting-acceptance');
    assert.equal(first.body.detail.payments[0].refundedAmount, 0);
    assert.equal(first.body.detail.refunds.length, 1);
    assert.equal(first.body.detail.refunds[0].status, 'pending');
    const firstRefundId = first.body.detail.refunds[0].id;
    const firstAmount = first.body.detail.refunds[0].amount;

    const second = await http.as.lan('POST', `/orders/${paidId}/lines/${traDao.id}/cancel`, {
      quantity: 1,
      reason: 'hết trà đào',
    });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.ok(second.body.refundAmount > 0);
    assert.equal(second.body.detail.order.paymentStatus, 'paid');
    assert.equal(second.body.detail.payments[0].refundedAmount, 0);
    assert.equal(second.body.detail.refunds.length, 2);
    assert.equal(second.body.detail.refunds.every((row) => row.status === 'pending'), true);

    const settled = await http.as.lan('POST', `/refunds/${firstRefundId}/settle`, { reference: 'FTLINE1001' });
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    assert.equal(settled.body.order.paymentStatus, 'partially-refunded');
    assert.equal(settled.body.order.status, 'open');
    assert.equal(settled.body.group.status, 'awaiting-acceptance');
    assert.equal(settled.body.payments[0].refundedAmount, firstAmount);
    assert.equal(settled.body.totals.refunded, firstAmount);
    const settledJson = JSON.stringify(settled.body);
    assert.equal(settledJson.includes('FTLINE1001'), false);
    assert.equal(settledJson.includes(payToken), false);
    const settledRow = settled.body.refunds.find((row) => row.id === firstRefundId);
    assert.equal(settledRow.referenceMasked, 'FTLI•••1001');
    assert.equal(settled.body.refunds.find((row) => row.id !== firstRefundId).status, 'pending');

    const held = await order.createOrder(basicOrderInput(), systemCtx);
    const heldId = held.order.order.id;
    const heldLine = held.order.lines.find((line) => line.sellableUid === 'goi-cuon');
    const heldPaid = await postTransfer({
      id: 99102,
      transferType: 'in',
      transferAmount: held.order.order.totalAmount,
      accountNumber: '0123456789',
      content: `SLC${held.order.order.code}`,
      referenceCode: 'FTLINK99102',
    });
    assert.equal(heldPaid.status, 200, JSON.stringify(heldPaid.body));
    const reserved = await http.as.lan('POST', `/orders/${heldId}/refunds`, {
      method: 'bank',
      amount: held.order.order.totalAmount,
      reason: 'giữ toàn bộ để hoàn',
      idempotencyKey: 'link-hold-all',
    });
    assert.equal(reserved.status, 200, JSON.stringify(reserved.body));
    assert.equal(reserved.body.order.paymentStatus, 'paid');
    const shortfall = await http.as.lan('POST', `/orders/${heldId}/lines/${heldLine.id}/cancel`, {
      quantity: 1,
      reason: 'hủy khi tiền đã giữ',
    });
    assert.equal(shortfall.status, 200, JSON.stringify(shortfall.body));
    assert.equal(shortfall.body.refundAmount, 0);
    assert.ok(shortfall.body.refundShortfall > 0);
    assert.equal(shortfall.body.detail.order.paymentStatus, 'paid');
    assert.equal(shortfall.body.detail.payments[0].refundedAmount, 0);
    assert.equal(shortfall.body.detail.refunds.length, 1);
    const canceledLine = shortfall.body.detail.lines.find((line) => line.id === heldLine.id);
    assert.equal(canceledLine.canceledQuantity, 1);

    console.log('[ordering-test] sepay link: payment token, expiry extension, partial cancel');
  } finally {
    await http.cleanup();
  }
});
