// O4 step 7: staff record a transfer by bank reference. A later webhook with the same
// reference and the same amount confirms that row and does not capture again. A transfer the
// webhook already stored cannot be recorded again by hand. A paid order rejected or canceled
// by staff gets a pending transfer refund. No call to SePay.
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
  const { order } = services(app);
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
  const http = await seedAdminHttpStaff(app, {
    scopes: { lan: { allLocations: false, locationRefs: ['Q1'] } },
  });

  try {
    const place = () => order.createOrder(basicOrderInput(), systemCtx);
    const load = (orderId) => order.getOrder(orderId, systemCtx);
    const capturedOf = (aggregate) =>
      aggregate.payments.reduce((sum, payment) => sum + payment.capturedAmount, 0);
    const rowsFor = async (...ids) => {
      const all = await events().findMany({ where: { providerCode: 'sepay' } });
      return all.filter((row) => ids.includes(row.providerTransactionId));
    };

    const placed = await place();
    const orderId = placed.order.order.id;
    const total = placed.order.order.totalAmount;
    const code = placed.order.order.code;
    assert.equal(placed.order.groups[0].status, 'awaiting-payment');

    const badRef = await http.as.lan('POST', `/orders/${orderId}/manual-payments`, {
      reference: 'có dấu cách',
      amount: total,
    });
    assert.equal(badRef.status, 400);
    assert.equal(badRef.body.error.code, 'VALIDATION_ERROR');
    const zero = await http.as.lan('POST', `/orders/${orderId}/manual-payments`, {
      reference: 'FT9001',
      amount: 0,
    });
    assert.equal(zero.status, 400);
    assert.equal(zero.body.error.code, 'VALIDATION_ERROR');
    assert.equal(capturedOf(await load(orderId)), 0);

    const recorded = await http.as.lan('POST', `/orders/${orderId}/manual-payments`, {
      reference: 'FT9001',
      amount: total,
      note: 'khách chuyển đủ',
    });
    assert.equal(recorded.status, 200, JSON.stringify(recorded.body));
    assert.equal(recorded.body.reviewStatus, 'matched-manually');
    assert.equal(recorded.body.confirmed, false);

    let agg = await load(orderId);
    assert.equal(agg.groups[0].status, 'awaiting-acceptance');
    assert.equal(agg.order.paymentStatus, 'paid');
    assert.equal(agg.payments.length, 1);
    assert.equal(capturedOf(agg), total);
    let stored = await rowsFor('FT9001', '9100');
    assert.equal(stored.length, 1);
    assert.equal(stored[0].kind, 'manual');
    assert.equal(stored[0].rawPayload.confirmed, false);
    assert.equal(stored[0].rawPayload.manual, true);
    const storedJson = JSON.stringify(stored[0].rawPayload);
    assert.equal(storedJson.includes('0123456789'), false);
    assert.equal(storedJson.includes('SENDER-NAME-XYZ'), false);
    assert.equal(storedJson.includes('khách chuyển đủ'), false);

    const detail = await http.as.lan('GET', `/orders/${orderId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.paymentEvents.length, 1);
    assert.equal(detail.body.paymentEvents[0].referenceMasked, 'FT•••');
    assert.equal(detail.body.paymentEvents[0].confirmed, false);
    assert.equal(detail.body.paymentEvents[0].kind, 'manual');
    const detailJson = JSON.stringify(detail.body);
    assert.equal(detailJson.includes('FT9001'), false);
    assert.equal(detailJson.includes('0123456789'), false);

    const logs = await app.db.query('plugin::ordering.admin-change-log').findMany({
      where: { action: 'payment-manual.record', entityId: String(recorded.body.eventId) },
    });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].changes.reason.after, 'khách chuyển đủ');
    assert.equal(logs[0].changes.reference.after, 'FT9001');
    assert.equal(JSON.stringify(logs[0]).includes('0123456789'), false);
    assert.equal(JSON.stringify(logs[0]).includes('SENDER-NAME-XYZ'), false);

    const history = await app.db.query('plugin::ordering.order-event').findMany({
      where: { order: orderId, type: 'payment.captured' },
    });
    assert.equal(history.length, 1);
    const historyJson = JSON.stringify(history[0].payload);
    assert.equal(history[0].payload.manual, true);
    assert.equal(historyJson.includes('FT9001'), false);
    assert.equal(historyJson.includes('0123456789'), false);

    const webhook = await post({
      id: 9100,
      transferType: 'in',
      transferAmount: total,
      accountNumber: '0123456789',
      content: `SENDER-NAME-XYZ SLC${code}`,
      referenceCode: 'FT9001',
    });
    assert.equal(webhook.status, 200);
    assert.deepEqual(webhook.body, { success: true });
    stored = await rowsFor('FT9001', '9100');
    assert.equal(stored.length, 1);
    assert.equal(stored[0].providerTransactionId, 'FT9001');
    assert.equal(stored[0].rawPayload.confirmed, true);
    assert.equal(stored[0].rawPayload.sepayTransactionId, '9100');
    assert.ok(stored[0].rawPayload.transferredAt, 'confirming keeps the staff transfer time');
    assert.equal(JSON.stringify(stored[0].rawPayload).includes('0123456789'), false);
    assert.equal(JSON.stringify(stored[0].rawPayload).includes('SENDER-NAME-XYZ'), false);
    agg = await load(orderId);
    assert.equal(capturedOf(agg), total);
    assert.equal(agg.payments.length, 1);
    assert.equal(agg.groups[0].status, 'awaiting-acceptance');

    const replay = await post({
      id: 9100,
      transferType: 'in',
      transferAmount: total,
      accountNumber: '0123456789',
      content: `SENDER-NAME-XYZ SLC${code}`,
      referenceCode: 'FT9001',
    });
    assert.deepEqual(replay.body, { success: true });
    assert.equal((await rowsFor('FT9001', '9100')).length, 1);
    assert.equal(capturedOf(await load(orderId)), total);

    const again = await http.as.lan('POST', `/orders/${orderId}/manual-payments`, {
      reference: 'FT9001',
      amount: total,
    });
    assert.equal(again.status, 400);
    assert.equal(again.body.error.code, 'VALIDATION_ERROR');
    assert.equal((await rowsFor('FT9001')).length, 1);

    const after = await http.as.lan('GET', `/orders/${orderId}`);
    assert.equal(after.body.paymentEvents.length, 1);
    assert.equal(after.body.paymentEvents[0].confirmed, true);
    assert.equal(after.body.paymentEvents[0].referenceMasked, 'FT•••');
    assert.equal(JSON.stringify(after.body).includes('FT9001'), false);
    assert.equal(JSON.stringify(after.body).includes('SENDER-NAME-XYZ'), false);

    // Half the due, recorded by hand, then the same amount comes back from SePay. Matching the
    // remainder would capture a second time; attaching to the manual row must not.
    const part = total / 2;
    assert.equal(part * 2, total);
    const half = await place();
    const halfId = half.order.order.id;
    const halfRecorded = await http.as.lan('POST', `/orders/${halfId}/manual-payments`, {
      reference: 'HALF9003',
      amount: part,
    });
    assert.equal(halfRecorded.status, 200, JSON.stringify(halfRecorded.body));
    const halfWebhook = await post({
      id: 9200,
      transferType: 'in',
      transferAmount: part,
      accountNumber: '0123456789',
      content: `SLC${half.order.order.code}`,
      referenceCode: 'HALF9003',
    });
    assert.deepEqual(halfWebhook.body, { success: true });
    const halfRows = await rowsFor('HALF9003', '9200');
    assert.equal(halfRows.length, 1);
    assert.equal(halfRows[0].rawPayload.confirmed, true);
    agg = await load(halfId);
    assert.equal(capturedOf(agg), part);
    assert.equal(agg.groups[0].status, 'awaiting-payment');
    assert.equal(agg.order.paymentStatus, 'partially-paid');

    const mismatch = await place();
    const mismatchId = mismatch.order.order.id;
    const mismatchRecorded = await http.as.lan('POST', `/orders/${mismatchId}/manual-payments`, {
      reference: 'FT9002',
      amount: total,
    });
    assert.equal(mismatchRecorded.status, 200);
    const mismatchWebhook = await post({
      id: 9101,
      transferType: 'in',
      transferAmount: 10_000,
      accountNumber: '0123456789',
      content: `SLC${mismatch.order.order.code}`,
      referenceCode: 'FT9002',
    });
    assert.deepEqual(mismatchWebhook.body, { success: true });
    const manualRow = (await rowsFor('FT9002'))[0];
    const webhookRow = (await rowsFor('9101'))[0];
    assert.equal(manualRow.rawPayload.confirmed, false);
    assert.equal(webhookRow.reviewStatus, 'needs-review');
    assert.equal(webhookRow.reviewReason, 'underpaid');
    agg = await load(mismatchId);
    assert.equal(capturedOf(agg), total);
    assert.equal(agg.groups[0].status, 'awaiting-acceptance');

    const typed = await place();
    const typedId = typed.order.order.id;
    const typedRecorded = await http.as.lan('POST', `/orders/${typedId}/manual-payments`, {
      reference: '9102',
      amount: total,
    });
    assert.equal(typedRecorded.status, 200);
    const typedWebhook = await post({
      id: 9102,
      transferType: 'in',
      transferAmount: total,
      accountNumber: '0123456789',
      content: `SLC${typed.order.order.code}`,
      referenceCode: '9102',
    });
    assert.deepEqual(typedWebhook.body, { success: true });
    const typedRows = await rowsFor('9102');
    assert.equal(typedRows.length, 1);
    assert.equal(typedRows[0].kind, 'manual');
    assert.equal(typedRows[0].rawPayload.confirmed, true);
    assert.equal(capturedOf(await load(typedId)), total);

    // The webhook came first and already captured. Recording the same bank reference by hand
    // (any letter case) is refused, so the ledger is not credited twice.
    const webFirst = await place();
    const webFirstId = webFirst.order.order.id;
    const webFirstHook = await post({
      id: 9300,
      transferType: 'in',
      transferAmount: total,
      accountNumber: '0123456789',
      content: `SLC${webFirst.order.order.code}`,
      referenceCode: 'FTWEB9300',
    });
    assert.deepEqual(webFirstHook.body, { success: true });
    assert.equal(capturedOf(await load(webFirstId)), total);
    const lateManual = await http.as.lan('POST', `/orders/${webFirstId}/manual-payments`, {
      reference: 'ftweb9300',
      amount: total,
    });
    assert.equal(lateManual.status, 409, JSON.stringify(lateManual.body));
    assert.equal(lateManual.body.error.code, 'PAYMENT_ALREADY_RECEIVED');
    const webFirstAgg = await load(webFirstId);
    assert.equal(capturedOf(webFirstAgg), total);
    assert.equal((await rowsFor('ftweb9300', 'FTWEB9300')).length, 0);

    const q3 = await order.createOrder(
      basicOrderInput({
        locationRef: 'Q3',
        receiveMethod: { kind: 'pickup', locationRef: 'Q3' },
      }),
      systemCtx,
    );
    const denied = await http.as.lan('POST', `/orders/${q3.order.order.id}/manual-payments`, {
      reference: 'FT9009',
      amount: 1000,
    });
    assert.equal(denied.status, 404);
    assert.equal(denied.body.error.code, 'ORDER_NOT_FOUND');
    assert.equal((await rowsFor('FT9009')).length, 0);

    // A paid pickup order closed by staff owes the transfer back as a pending refund, whether
    // it is rejected or canceled; cancel through the transition endpoint is refused.
    const paidPickup = async (reference) => {
      const placedPaid = await place();
      const paidId = placedPaid.order.order.id;
      const paid = await http.as.lan('POST', `/orders/${paidId}/manual-payments`, {
        reference,
        amount: placedPaid.order.order.totalAmount,
      });
      assert.equal(paid.status, 200, JSON.stringify(paid.body));
      assert.equal((await load(paidId)).groups[0].status, 'awaiting-acceptance');
      return { id: paidId, total: placedPaid.order.order.totalAmount };
    };
    const rejectedPickup = await paidPickup('FT9401');
    const viaTransition = await http.as.lan('POST', `/orders/${rejectedPickup.id}/transition`, {
      to: 'canceled',
      reasonCode: 'other',
      note: 'hủy',
    });
    assert.equal(viaTransition.status, 409);
    assert.equal(viaTransition.body.error.code, 'INVALID_TRANSITION');
    assert.equal(viaTransition.body.error.details.use, 'cancel');
    assert.equal((await load(rejectedPickup.id)).refunds.length, 0);
    const reject = await http.as.lan('POST', `/orders/${rejectedPickup.id}/transition`, {
      to: 'rejected',
      reasonCode: 'other',
      note: 'hết món',
    });
    assert.equal(reject.status, 200, JSON.stringify(reject.body));
    assert.equal(reject.body.refundPending, rejectedPickup.total);
    const rejectedAgg = await load(rejectedPickup.id);
    assert.equal(rejectedAgg.order.status, 'canceled');
    assert.deepEqual(
      rejectedAgg.refunds.map((refund) => [refund.status, refund.amount]),
      [['pending', rejectedPickup.total]],
    );
    const canceledPickup = await paidPickup('FT9402');
    const cancel = await http.as.lan('POST', `/orders/${canceledPickup.id}/cancel`, {
      reasonCode: 'other',
      note: 'khách đổi ý',
    });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal(cancel.body.refunded, 0);
    assert.equal(cancel.body.refundPending, canceledPickup.total);
    assert.deepEqual(
      (await load(canceledPickup.id)).refunds.map((refund) => refund.status),
      ['pending'],
    );

    console.log(
      '[ordering-test] sepay manual: record, attach, mismatch, webhook first, scope, paid reject/cancel refunds',
    );
  } finally {
    await http.cleanup();
  }
});
