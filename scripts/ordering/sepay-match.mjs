// O4 step 5: a matching transfer captures and moves the workflow; each review reason leaves
// the order alone. An assigned underpayment stays waiting, and a coded top-up of the
// remainder then matches. No call to SePay.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { basicOrderInput, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const sign = (secret, timestamp, rawBody) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

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
  await app.listen();
  const secret = app.config.get('plugin::ordering').providers.payment.sepay.webhookSecret;
  const url = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering/webhooks/sepay`;
  const events = () => app.db.query('plugin::ordering.payment-event');
  let seq = 1000;
  const post = async (payload) => {
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
  const transfer = (id, orderCode, amount, accountNumber, content) =>
    post({
      id,
      transferType: 'in',
      transferAmount: amount,
      accountNumber,
      content: content ?? `SLC${orderCode}`,
    });

  const { order, transition } = services(app);
  const matching = app.plugin('ordering').service('payment-matching');
  const storefront = app.plugin('ordering').service('storefront');
  const place = () => order.createOrder(basicOrderInput(), systemCtx);
  const load = (orderId) => order.getOrder(orderId, systemCtx);
  const capturedOf = (aggregate) =>
    aggregate.payments.reduce((sum, payment) => sum + payment.capturedAmount, 0);

  const prepay = await place();
  const total = prepay.order.order.totalAmount;
  const code = prepay.order.order.code;
  assert.equal(prepay.order.groups[0].status, 'awaiting-payment');
  const presentation = await storefront.paymentByToken(prepay.publicToken);
  assert.equal(presentation.due, total);
  assert.equal(presentation.presentation.memo, `SLC${code}`);
  assert.equal(presentation.presentation.bankAccount.accountNumber, '0123456789');
  assert.ok(String(presentation.presentation.qr).startsWith('data:image/svg+xml,'));
  assert.ok(presentation.presentation.expiresAt);

  const payId = ++seq;
  const paid = await transfer(payId, code, total, '0123456789');
  assert.equal(paid.status, 200);
  assert.deepEqual(paid.body, { success: true });
  let agg = await load(prepay.order.order.id);
  assert.equal(agg.groups[0].status, 'awaiting-acceptance');
  assert.equal(agg.order.paymentStatus, 'paid');
  assert.equal(capturedOf(agg), total);
  assert.equal((await storefront.paymentByToken(prepay.publicToken)).presentation, null);

  const replay = await transfer(payId, code, total, '0123456789');
  assert.deepEqual(replay.body, { success: true });
  assert.equal((await events().findMany({ where: { providerTransactionId: String(payId) } })).length, 1);
  assert.equal(capturedOf(await load(prepay.order.order.id)), total);

  const short = await place();
  const underId = ++seq;
  const shortfall = 50_000;
  const under = await transfer(underId, short.order.order.code, total - shortfall, '0123456789');
  assert.deepEqual(under.body, { success: true });
  agg = await load(short.order.order.id);
  assert.equal(agg.groups[0].status, 'awaiting-payment');
  assert.equal(agg.order.paymentStatus, 'unpaid');
  assert.equal(agg.payments.length, 0);
  assert.equal(
    (await events().findOne({ where: { providerTransactionId: String(underId) } })).reviewReason,
    'underpaid',
  );

  const assigned = await matching.assignEvent(
    { providerCode: 'sepay', providerTransactionId: String(underId), orderId: short.order.order.id },
    systemCtx,
  );
  assert.equal(assigned.applied, true);
  assert.equal(assigned.capturedAmount, total - shortfall);
  const again = await matching.assignEvent(
    { providerCode: 'sepay', providerTransactionId: String(underId), orderId: short.order.order.id },
    systemCtx,
  );
  assert.equal(again.applied, false);
  agg = await load(short.order.order.id);
  assert.equal(agg.groups[0].status, 'awaiting-payment', 'a short assign does not move the order');
  assert.equal(agg.order.paymentStatus, 'partially-paid');
  assert.equal(capturedOf(agg), total - shortfall);

  const topUp = await transfer(++seq, short.order.order.code, shortfall, '0123456789');
  assert.deepEqual(topUp.body, { success: true });
  agg = await load(short.order.order.id);
  assert.equal(agg.groups[0].status, 'awaiting-acceptance');
  assert.equal(agg.order.paymentStatus, 'paid');
  assert.equal(capturedOf(agg), total);

  await setTiming('accept-then-pay');
  const accepted = await place();
  assert.equal(accepted.order.groups[0].status, 'awaiting-acceptance');
  await transition.transitionGroup(
    { orderId: accepted.order.order.id, groupId: accepted.order.groups[0].id, to: 'awaiting-payment' },
    systemCtx,
  );
  const reviewId = accepted.order.order.id;
  const reviewCode = accepted.order.order.code;
  const unchanged = async (reason, payload) => {
    const before = await load(reviewId);
    const res = await post(payload);
    assert.equal(res.status, 200, reason);
    assert.deepEqual(res.body, { success: true });
    const row = await events().findOne({ where: { providerTransactionId: String(payload.id) } });
    assert.equal(row.reviewReason, reason);
    const after = await load(reviewId);
    assert.equal(after.groups[0].status, before.groups[0].status);
    assert.equal(after.order.paymentStatus, before.order.paymentStatus);
    assert.equal(capturedOf(after), capturedOf(before));
  };
  await unchanged('no-code', {
    id: ++seq,
    transferType: 'in',
    transferAmount: total,
    accountNumber: '0123456789',
    content: 'khong co ma',
  });
  await unchanged('order-not-found', {
    id: ++seq,
    transferType: 'in',
    transferAmount: total,
    accountNumber: '0123456789',
    content: 'SLCSLC-999999',
  });
  await unchanged('account-mismatch', {
    id: ++seq,
    transferType: 'in',
    transferAmount: total,
    accountNumber: '333000111222',
    content: `SLC${reviewCode}`,
  });
  await unchanged('overpaid', {
    id: ++seq,
    transferType: 'in',
    transferAmount: total + 1_000,
    accountNumber: '0123456789',
    content: `SLC${reviewCode}`,
  });

  const settled = await transfer(++seq, reviewCode, total, '0123456789');
  assert.deepEqual(settled.body, { success: true });
  agg = await load(reviewId);
  assert.equal(agg.groups[0].status, 'preparing');
  assert.equal(agg.order.paymentStatus, 'paid');
  await unchanged('already-paid', {
    id: ++seq,
    transferType: 'in',
    transferAmount: total,
    accountNumber: '0123456789',
    content: `SLC${reviewCode}`,
  });
  assert.equal(capturedOf(await load(reviewId)), total);

  const doomed = await place();
  await transition.transitionGroup(
    { orderId: doomed.order.order.id, groupId: doomed.order.groups[0].id, to: 'awaiting-payment' },
    systemCtx,
  );
  await transition.cancelOrder({ orderId: doomed.order.order.id, reason: 'khach huy' }, systemCtx);
  const closedId = ++seq;
  const closed = await transfer(closedId, doomed.order.order.code, total, '0123456789');
  assert.deepEqual(closed.body, { success: true });
  assert.equal(
    (await events().findOne({ where: { providerTransactionId: String(closedId) } })).reviewReason,
    'order-closed',
  );
  agg = await load(doomed.order.order.id);
  assert.equal(agg.groups[0].status, 'canceled');
  assert.equal(agg.payments.length, 0);

  console.log('[ordering-test] sepay match: prepay, top-up, accept-then-pay, seven review reasons');
});
