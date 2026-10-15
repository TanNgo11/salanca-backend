// O4 step 6: staff review of unmatched transfers. Branch scope hides money that is not
// theirs; an unknown account is visible only to allLocations. Two reviewers of one event:
// one succeeds, the other gets REVIEW_ALREADY_RESOLVED. No call to SePay.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { basicOrderInput, seedAdminHttpStaff, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const sign = (secret, timestamp, rawBody) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

const evidence = (name, data) => console.log(`EVIDENCE ${name} ${JSON.stringify(data)}`);

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

    // A SHORT late transfer must keep the reopened order waiting for the rest: it resumes at
    // `awaiting-payment` and is never sent to the kitchen unpaid (O-11 review).
    const shortOrder = await place();
    await transition.cancelOrder({ orderId: shortOrder.order.order.id, reason: 'khach huy' }, systemCtx);
    const shortTxn = seq + 1;
    await transfer('0123456789', Math.floor(total / 2), `SLC${shortOrder.order.order.code}`);
    const shortEvent = await eventOf(shortTxn);
    assert.equal(shortEvent.reviewReason, 'order-closed');
    const shortReopen = await http.as.lan('POST', `/payment-reviews/${shortEvent.id}/reopen`, {
      orderId: shortOrder.order.order.id,
      reason: 'khách chuyển thiếu sau khi hủy',
    });
    assert.equal(shortReopen.status, 200, JSON.stringify(shortReopen.body));
    const shortAgg = await load(shortOrder.order.order.id);
    assert.equal(shortAgg.groups[0].status, 'awaiting-payment', 'a short transfer keeps waiting');
    assert.notEqual(shortAgg.order.paymentStatus, 'paid');

    // Reopen and promotion uses (audit O-08 remainder). Cancelling an order releases its promotion
    // redemption, so a reopen must win that use back. When another order took the last one the
    // reopen is refused — reopening would keep the discount with no use behind it.
    const promotionFor = async (name, code, usageLimit) => {
      const row = await app.db.query('plugin::ordering.promotion').create({
        data: {
          name: { vi: name, en: name },
          kind: 'code',
          discountType: 'percent',
          value: 10,
          maxDiscount: null,
          target: { kind: 'order', refs: [] },
          minSubtotal: 0,
          locationRefs: ['Q1'],
          receiveKinds: ['pickup'],
          startsAt: '2026-10-01T00:00:00.000Z',
          endsAt: null,
          weekdays: [],
          timeRanges: [],
          firstOrderOnly: false,
          usageLimit,
          perCustomerLimit: null,
          stackable: true,
          priority: 1,
          active: true,
          usedCount: 0,
        },
      });
      await app.db.query('plugin::ordering.promotion-code').create({
        data: { promotionId: row.id, code, usageLimit: null, usedCount: 0, active: true },
      });
      return row;
    };
    const usesOf = async (promotionId) =>
      Number(
        (await app.db.query('plugin::ordering.promotion').findOne({ where: { id: promotionId } }))
          .usedCount,
      );
    const redemptionOf = async (orderId) =>
      app.db.query('plugin::ordering.promotion-redemption').findOne({ where: { orderId } });
    const withCode = (code) =>
      basicOrderInput({ adjustments: [], promotionCode: code, contact: { name: 'Khách test', phone: '+84901110999' } });
    const lateTransferFor = async (orderId) => {
      const aggregate = await load(orderId);
      const txn = seq + 1;
      await transfer('0123456789', aggregate.order.totalAmount, `SLC${aggregate.order.code}`);
      const event = await eventOf(txn);
      assert.equal(event.reviewReason, 'order-closed');
      return event;
    };

    const oneUse = await promotionFor('Một lượt', 'MOTLAN', 1);
    const firstUser = await order.createOrder(withCode('MOTLAN'), systemCtx);
    assert.equal(await usesOf(oneUse.id), 1);
    await transition.cancelOrder({ orderId: firstUser.order.order.id, reason: 'khách hủy' }, systemCtx);
    assert.equal(await usesOf(oneUse.id), 0, 'cancelling gives the use back');
    const secondUser = await order.createOrder(withCode('MOTLAN'), systemCtx);
    assert.equal(await usesOf(oneUse.id), 1, 'the second order takes the last use');

    const oneUseEvent = await lateTransferFor(firstUser.order.order.id);
    const refusedReopen = await http.as.lan('POST', `/payment-reviews/${oneUseEvent.id}/reopen`, {
      orderId: firstUser.order.order.id,
      reason: 'khách chuyển muộn nhưng hết lượt',
    });
    const refusedAgg = await load(firstUser.order.order.id);
    const refusedUseCount = await usesOf(oneUse.id);
    const secondStillLive = await load(secondUser.order.order.id);
    evidence('reopen-refused-when-promotion-use-was-taken', {
      status: refusedReopen.status,
      code: refusedReopen.body?.error?.code ?? null,
      promotionUsedCount: refusedUseCount,
      reopenedStatus: refusedAgg.order.status,
      secondOrderStatus: secondStillLive.order.status,
      eventReviewStatus: (await eventOf(oneUseEvent.providerTransactionId)).reviewStatus,
    });
    assert.equal(refusedReopen.status, 409, JSON.stringify(refusedReopen.body));
    assert.equal(refusedReopen.body.error.code, 'REOPEN_UNAVAILABLE');
    assert.equal(refusedUseCount, 1, 'the use stays with the order that holds it');
    assert.equal(refusedAgg.order.status, 'canceled');
    assert.equal(secondStillLive.order.status !== 'canceled', true);
    assert.equal(
      (await eventOf(oneUseEvent.providerTransactionId)).reviewStatus,
      'needs-review',
      'a refused reopen leaves the transfer in the review queue',
    );

    // With a use still available the reopen restores it, so the reopened order holds its discount.
    const spare = await promotionFor('Còn lượt', 'CONLUOT', null);
    const spareOrder = await order.createOrder(withCode('CONLUOT'), systemCtx);
    assert.equal(await usesOf(spare.id), 1);
    await transition.cancelOrder({ orderId: spareOrder.order.order.id, reason: 'khách hủy' }, systemCtx);
    assert.equal(await usesOf(spare.id), 0);
    const spareEvent = await lateTransferFor(spareOrder.order.order.id);
    const spareReopen = await http.as.lan('POST', `/payment-reviews/${spareEvent.id}/reopen`, {
      orderId: spareOrder.order.order.id,
      reason: 'khách chuyển sau khi hủy còn lượt',
    });
    const spareAgg = await load(spareOrder.order.order.id);
    const spareRedemption = await redemptionOf(spareOrder.order.order.id);
    evidence('reopen-restores-the-promotion-use', {
      status: spareReopen.status,
      promotionUsedCount: await usesOf(spare.id),
      redemptionStatus: spareRedemption?.status ?? null,
      reopenedStatus: spareAgg.order.status,
    });
    assert.equal(spareReopen.status, 200, JSON.stringify(spareReopen.body));
    assert.equal(await usesOf(spare.id), 1, 'the use is held again');
    assert.equal(spareRedemption.status, 'reserved');

    console.log('[ordering-test] sepay review: scope, race, ignore, refund-due, closed assign, reopen');
  } finally {
    await http.cleanup();
  }
});
