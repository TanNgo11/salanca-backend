// O4 step 6: staff review of unmatched transfers. Branch scope hides money that is not
// theirs; an unknown account is visible only to allLocations. Two reviewers of one event:
// one succeeds, the other gets REVIEW_ALREADY_RESOLVED. No call to SePay.
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
  const events = () => app.db.query('plugin::ordering.payment-event');
  const { order, transition } = services(app);
  let seq = 9000;
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
    assert.equal(res.status, 200);
    assert.deepEqual(text ? JSON.parse(text) : null, { success: true });
  };
  const transfer = (accountNumber, amount, content) =>
    post({ id: ++seq, transferType: 'in', transferAmount: amount, accountNumber, content });
  const eventOf = async (txn) => {
    const row = await events().findOne({ where: { providerTransactionId: String(txn) } });
    assert.ok(row, `event ${txn}`);
    return row;
  };

  const http = await seedAdminHttpStaff(app, {
    scopes: {
      lan: { allLocations: false, locationRefs: ['Q1'] },
      minh: { allLocations: false, locationRefs: ['Q1'] },
      chain: { allLocations: true, locationRefs: [] },
    },
  });

  try {
    const place = () => order.createOrder(basicOrderInput(), systemCtx);
    const load = (orderId) => order.getOrder(orderId, systemCtx);
    const short = await place();
    const total = short.order.order.totalAmount;
    const shortfall = 50_000;
    const underTxn = seq + 1;
    await transfer('0123456789', total - shortfall, `SLC${short.order.order.code}`);
    const under = await eventOf(underTxn);
    assert.equal(under.reviewReason, 'underpaid');

    const closed = await place();
    await transition.cancelOrder({ orderId: closed.order.order.id, reason: 'khach huy' }, systemCtx);
    const closedTxn = seq + 1;
    await transfer('0123456789', total, `SLC${closed.order.order.code}`);
    const closedEvent = await eventOf(closedTxn);
    assert.equal(closedEvent.reviewReason, 'order-closed');

    const ignoreTxn = seq + 1;
    await transfer('0123456789', 80_000, 'chuyen noi bo');
    const refundTxn = seq + 1;
    await transfer('0123456789', 70_000, 'chuyen nham');
    const q3Txn = seq + 1;
    await transfer('333000111222', 60_000, 'tien q3');
    const unknownTxn = seq + 1;
    await transfer('555555555555', 40_000, 'khong ro chi nhanh');

    // A reconciliation row has no account number or memo text, only the account key and code.
    const reconciled = await place();
    const reconciledRow = await events().create({
      data: {
        providerCode: 'sepay',
        providerTransactionId: 'b6f1c0de-0000-4000-8000-000000000001',
        transferType: 'in',
        amount: 30_000,
        currency: 'VND',
        kind: 'transfer',
        rawPayload: {
          source: 'reconciliation',
          accountKey: 'q1',
          memoCode: reconciled.order.order.code,
          referenceCode: 'FTRECREV1',
          transactionDate: '2026-10-11 09:00:00',
          transferType: 'in',
        },
        receivedAt: new Date(Date.now() - 60 * 60_000),
        reviewStatus: 'needs-review',
        reviewReason: 'underpaid',
      },
    });

    // Auto-matched transfers far outnumber open reviews. They must not push older open rows
    // out of the list or the counts.
    const knex = app.db.connection;
    const filler = Array.from({ length: 600 }, (_, index) => ({
      provider_code: 'sepay',
      provider_transaction_id: `filler-${index}`,
      transfer_type: 'in',
      amount: 1000,
      currency: 'VND',
      kind: 'transfer',
      raw_payload: JSON.stringify({ accountNumber: '0123456789', content: 'filler' }),
      received_at: new Date(Date.now() + 60_000),
      review_status: 'auto-matched',
    }));
    await knex.batchInsert('plugins_ordering_payment_event', filler, 200);

    const lanList = await http.as.lan('GET', '/payment-reviews?status=open&pageSize=100');
    assert.equal(lanList.status, 200);
    const lanIds = lanList.body.results.map((row) => row.providerTransactionId);
    assert.ok(lanIds.includes(String(underTxn)));
    assert.ok(lanIds.includes(String(closedTxn)));
    assert.ok(lanIds.includes(String(ignoreTxn)));
    assert.ok(!lanIds.includes(String(q3Txn)), 'Q1 staff must not see a Q3 account');
    assert.ok(!lanIds.includes(String(unknownTxn)), 'Q1 staff must not see an unknown account');
    assert.equal(JSON.stringify(lanList.body).includes('0123456789'), false);
    assert.equal(JSON.stringify(lanList.body).includes('555555555555'), false);
    const underRow = lanList.body.results.find((row) => row.providerTransactionId === String(underTxn));
    assert.equal(underRow.accountMasked, '0123•••6789');
    assert.equal(underRow.suggestedOrder.code, short.order.order.code);
    assert.equal(underRow.suggestedOrder.due, total);
    assert.equal(lanList.body.counts.open, lanList.body.pagination.total);
    assert.ok(lanList.body.counts.open >= 4, 'open reviews survive 600 newer auto-matched rows');
    const reconciledItem = lanList.body.results.find((row) => row.id === reconciledRow.id);
    assert.ok(reconciledItem, 'Q1 staff see a reconciled transfer into the Q1 account');
    assert.deepEqual(reconciledItem.locationRefs, ['Q1']);
    assert.equal(reconciledItem.suggestedOrder.code, reconciled.order.order.code);
    const byCode = await http.as.lan(
      'GET',
      `/payment-reviews?status=open&pageSize=100&q=${encodeURIComponent(reconciled.order.order.code.toLowerCase())}`,
    );
    assert.ok(byCode.body.results.some((row) => row.id === reconciledRow.id));
    const closedRow = lanList.body.results.find((row) => row.providerTransactionId === String(closedTxn));
    assert.equal(closedRow.canReopen, true);

    const chainList = await http.as.chain('GET', '/payment-reviews?status=open&pageSize=100');
    const chainIds = chainList.body.results.map((row) => row.providerTransactionId);
    assert.ok(chainIds.includes(String(unknownTxn)));
    assert.ok(chainIds.includes(String(q3Txn)));
    const unknownRow = chainList.body.results.find((row) => row.providerTransactionId === String(unknownTxn));
    assert.equal(unknownRow.locationRefs, null);
    assert.equal(unknownRow.accountMasked, '5555•••5555');

    const hidden = await http.as.lan('POST', `/payment-reviews/${(await eventOf(unknownTxn)).id}/ignore`, {
      reason: 'khong phai tien minh',
    });
    assert.equal(hidden.status, 404);
    assert.equal(hidden.body.error.code, 'PAYMENT_NOT_FOUND');

    const ignoreId = (await eventOf(ignoreTxn)).id;
    const notClosed = await http.as.lan('POST', `/payment-reviews/${ignoreId}/reopen`, {
      orderId: short.order.order.id,
      reason: 'mo lai khong dung',
    });
    assert.equal(notClosed.status, 409);
    assert.equal(notClosed.body.error.code, 'REOPEN_UNAVAILABLE');

    const shortReason = await http.as.lan('POST', `/payment-reviews/${under.id}/assign`, {
      orderId: short.order.order.id,
      reason: 'abc',
    });
    assert.equal(shortReason.status, 400);
    assert.equal(shortReason.body.error.code, 'VALIDATION_ERROR');

    const [first, second] = await Promise.all([
      http.as.lan('POST', `/payment-reviews/${under.id}/assign`, {
        orderId: short.order.order.id,
        reason: 'gán thiếu cho đơn này',
      }),
      http.as.minh('POST', `/payment-reviews/${under.id}/assign`, {
        orderId: short.order.order.id,
        reason: 'gán thiếu cho đơn này',
      }),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409]);
    const lost = [first, second].find((item) => item.status === 409);
    assert.equal(lost.body.error.code, 'REVIEW_ALREADY_RESOLVED');
    const again = await http.as.lan('POST', `/payment-reviews/${under.id}/assign`, {
      orderId: short.order.order.id,
      reason: 'gán lần nữa vẫn bị chặn',
    });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'REVIEW_ALREADY_RESOLVED');

    let agg = await load(short.order.order.id);
    assert.equal(agg.groups[0].status, 'awaiting-payment');
    assert.equal(agg.order.paymentStatus, 'partially-paid');
    const captured = agg.payments.reduce((sum, payment) => sum + payment.capturedAmount, 0);
    assert.equal(captured, total - shortfall);
    const logs = await app.db.query('plugin::ordering.admin-change-log').findMany({
      where: { entityType: 'payment-event', entityId: String(under.id), action: 'payment-review.assign' },
    });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].changes.reason.after, 'gán thiếu cho đơn này');
    const logged = JSON.stringify(logs[0]);
    assert.equal(logged.includes('0123456789'), false);
    assert.equal(logged.includes(`SLC${short.order.order.code}`), false);

    const resolved = await http.as.lan('GET', '/payment-reviews?status=resolved&pageSize=100');
    const resolvedRow = resolved.body.results.find((row) => row.id === under.id);
    assert.equal(resolvedRow.reviewStatus, 'matched-manually');
    assert.equal(resolvedRow.staffReason, 'gán thiếu cho đơn này');
    assert.equal(resolvedRow.suggestedOrder.due, shortfall);

    const ignored = await http.as.lan('POST', `/payment-reviews/${ignoreId}/ignore`, { reason: 'chuyển khoản nội bộ' });
    assert.equal(ignored.status, 200);
    assert.equal((await eventOf(ignoreTxn)).reviewStatus, 'ignored');
    const ignoreAgain = await http.as.minh('POST', `/payment-reviews/${ignoreId}/ignore`, { reason: 'bỏ qua lần hai' });
    assert.equal(ignoreAgain.status, 409);
    assert.equal(ignoreAgain.body.error.code, 'REVIEW_ALREADY_RESOLVED');

    const refundId = (await eventOf(refundTxn)).id;
    const tooSmall = await http.as.lan('POST', `/payment-reviews/${refundId}/refund-due`, { amount: 0, reason: 'số tiền không hợp lệ' });
    assert.equal(tooSmall.status, 400);
    const refunded = await http.as.lan('POST', `/payment-reviews/${refundId}/refund-due`, {
      amount: 10_000,
      reason: 'chuyển nhầm hoàn lại',
    });
    assert.equal(refunded.status, 200);
    const refund = await app.db.query('plugin::ordering.refund').findOne({ where: { id: refunded.body.refundId } });
    assert.equal(refund.status, 'pending');
    assert.equal(Number(refund.amount), 10_000);
    assert.equal(refund.payment ?? null, null);
    assert.equal(refund.order ?? null, null);
    assert.equal((await eventOf(refundTxn)).reviewStatus, 'refund-due');
    const refundLog = await app.db.query('plugin::ordering.admin-change-log').findMany({
      where: { action: 'payment-review.refund-due', entityId: String(refundId) },
    });
    assert.equal(refundLog.length, 1);
    assert.equal(refundLog[0].changes.refundId.after, refunded.body.refundId);
    agg = await load(short.order.order.id);
    assert.equal(agg.order.paymentStatus, 'partially-paid');
    const refundAgain = await http.as.minh('POST', `/payment-reviews/${refundId}/refund-due`, {
      reason: 'hoàn lần hai',
    });
    assert.equal(refundAgain.status, 409);

    const found = await http.as.lan('GET', `/payment-reviews/orders?q=${encodeURIComponent(short.order.order.code)}`);
    assert.equal(found.status, 200);
    assert.ok(found.body.results.some((item) => item.code === short.order.order.code));
    const byPhone = await http.as.lan('GET', '/payment-reviews/orders?q=0900000001');
    assert.ok(byPhone.body.results.some((item) => item.code === short.order.order.code));
    const tiny = await http.as.lan('GET', '/payment-reviews/orders?q=x');
    assert.deepEqual(tiny.body.results, []);

    // Assigning to a canceled order is refused; reopen is the way back.
    const strayTxn = seq + 1;
    await transfer('0123456789', 20_000, 'khong co ma');
    const strayAssign = await http.as.lan('POST', `/payment-reviews/${(await eventOf(strayTxn)).id}/assign`, {
      orderId: closed.order.order.id,
      reason: 'gán nhầm vào đơn đã hủy',
    });
    assert.equal(strayAssign.status, 409, JSON.stringify(strayAssign.body));
    assert.equal(strayAssign.body.error.code, 'ORDER_CLOSED');
    assert.equal((await eventOf(strayTxn)).reviewStatus, 'needs-review');
    assert.equal(
      (await load(closed.order.order.id)).payments.reduce((sum, payment) => sum + payment.capturedAmount, 0),
      0,
    );

    const reopened = await http.as.lan('POST', `/payment-reviews/${closedEvent.id}/reopen`, {
      orderId: closed.order.order.id,
      reason: 'khách chuyển sau khi hủy',
    });
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
    agg = await load(closed.order.order.id);
    assert.equal(agg.groups[0].status, 'awaiting-acceptance');
    assert.equal(agg.order.paymentStatus, 'paid');
    const reopenSteps = await app.db.query('plugin::ordering.order-event').findMany({
      where: { order: closed.order.order.id, type: 'fulfillment-group.transitioned' },
    });
    const reopenStep = reopenSteps.find((step) => step.payload.reason === 'payment-review-reopen');
    assert.ok(reopenStep, 'reopen is recorded like a transition');
    assert.equal(reopenStep.payload.from, 'canceled');
    assert.equal(reopenStep.payload.to, 'awaiting-payment');
    const reopenLog = await app.db.query('plugin::ordering.admin-change-log').findMany({
      where: { action: 'payment-review.reopen', entityId: String(closedEvent.id) },
    });
    assert.equal(reopenLog.length, 1);

    console.log('[ordering-test] sepay review: scope, race, ignore, refund-due, closed assign, reopen');
  } finally {
    await http.cleanup();
  }
});
