import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  basicOrderInput,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

withApp(async (app) => {
  const { order, transition, payment, refund } = services(app);
  await seedBranches(app);
  seedMenu(app);

  const created = await order.createOrder(basicOrderInput(), systemCtx);
  const orderId = created.order.order.id;

  const paymentRow = await payment.createPayment(
    { orderId, providerCode: 'test' },
    systemCtx,
  );
  assert.equal(paymentRow.requestedAmount, 195000);
  console.log('[ordering-test] payment initiated, requested', paymentRow.requestedAmount);

  await payment.capturePayment(
    { paymentId: paymentRow.id, amount: 100000, providerTransactionId: 'txn-a' },
    systemCtx,
  );
  let agg = await order.getOrder(orderId, systemCtx);
  assert.equal(agg.order.paymentStatus, 'partially-paid');
  assert.equal(agg.payments[0].status, 'pending');
  console.log('[ordering-test] capture 100000 → partially-paid, payment pending');

  const second = await payment.capturePayment(
    { paymentId: paymentRow.id, amount: 95000, providerTransactionId: 'txn-b' },
    systemCtx,
  );
  assert.equal(second.payment.status, 'captured');
  agg = await order.getOrder(orderId, systemCtx);
  assert.equal(agg.order.paymentStatus, 'paid');
  console.log('[ordering-test] capture remaining 95000 → paid/captured');

  // Now that payment is settled, delivering completes the order.
  for (const to of ['preparing', 'ready', 'delivered']) {
    await transition.transitionGroup(
      { orderId, groupId: agg.groups[0].id, to },
      systemCtx,
    );
  }
  agg = await order.getOrder(orderId, systemCtx);
  assert.equal(agg.order.status, 'completed');
  console.log('[ordering-test] delivered + paid → order completed');

  // Replayed providerTransactionId is a duplicate: ledger untouched, one event row.
  const dup = await payment.capturePayment(
    { paymentId: paymentRow.id, amount: 50000, providerTransactionId: 'txn-b' },
    systemCtx,
  );
  assert.equal(dup.duplicate, true);
  assert.equal(dup.payment.capturedAmount, 195000);
  const events = await app.db
    .query('plugin::ordering.payment-event')
    .findMany({ where: { providerTransactionId: 'txn-b' } });
  assert.equal(events.length, 1);
  console.log('[ordering-test] replayed txn-b → duplicate, capturedAmount still 195000');

  // Refund one unit of trà đào → telescoped 39886, partial refund status.
  const traDao = agg.lines.find((line) => line.sellableUid === 'tra-dao');
  const lineRefund = await refund.createRefund(
    {
      paymentId: paymentRow.id,
      lines: [{ lineId: traDao.id, quantity: 1 }],
      reason: 'customer return',
      idempotencyKey: randomUUID(),
    },
    systemCtx,
  );
  assert.equal(lineRefund.replayed, false);
  assert.equal(Number(lineRefund.refund.amount), 39886);
  agg = await order.getOrder(orderId, systemCtx);
  const refundedLine = agg.lines.find((line) => line.id === traDao.id);
  assert.equal(refundedLine.returnedQuantity, 1);
  assert.equal(agg.order.paymentStatus, 'partially-refunded');
  assert.equal(agg.order.status, 'completed'); // refunds never reopen a completed order
  console.log('[ordering-test] refund trà đào ×1 → 39886, partially-refunded, order stays completed');

  // Refund the rest by amount → fully refunded.
  const rest = await refund.createRefund(
    {
      paymentId: paymentRow.id,
      amount: 195000 - 39886,
      reason: 'cancel remainder',
      idempotencyKey: randomUUID(),
    },
    systemCtx,
  );
  assert.equal(Number(rest.refund.amount), 155114);
  agg = await order.getOrder(orderId, systemCtx);
  assert.equal(agg.order.paymentStatus, 'refunded');
  console.log('[ordering-test] refund remainder 155114 → refunded');

  await assert.rejects(
    refund.createRefund(
      {
        paymentId: paymentRow.id,
        amount: 1,
        reason: 'too much',
        idempotencyKey: randomUUID(),
      },
      systemCtx,
    ),
    (error) => error?.code === 'REFUND_EXCEEDS_CAPTURED',
  );
  console.log('[ordering-test] refund over the captured remainder → REFUND_EXCEEDS_CAPTURED');

  const replayKey = randomUUID();
  const first = await payment.capturePayment(
    { paymentId: paymentRow.id, amount: 10, providerTransactionId: 'txn-c' },
    systemCtx,
  );
  void first;
  const r1 = await refund.createRefund(
    { paymentId: paymentRow.id, amount: 10, reason: 'again', idempotencyKey: replayKey },
    systemCtx,
  );
  const r2 = await refund.createRefund(
    { paymentId: paymentRow.id, amount: 10, reason: 'again', idempotencyKey: replayKey },
    systemCtx,
  );
  assert.equal(r2.replayed, true);
  assert.equal(r2.refund.id, r1.refund.id);
  console.log('[ordering-test] same refund idempotency key → replayed');

  // An unmatched provider event is parked for review, not applied to any ledger.
  const parked = await payment.recordPaymentEvent(
    { providerCode: 'test', providerTransactionId: 'txn-ghost', kind: 'capture', amount: 999 },
    systemCtx,
  );
  assert.equal(parked.duplicate, false);
  assert.equal(parked.event.reviewStatus, 'needs-review');
  assert.equal(parked.event.reviewReason, 'order-not-found');
  console.log('[ordering-test] unmatched provider event → needs-review/order-not-found');
});
