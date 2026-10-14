// O13 step 2: MoMo wallet provider against a local mock of the AIO v2 gateway — no network
// call to MoMo. Covers session create (+ idempotent reuse), signed IPN capture, replay,
// bad signature, amount mismatch (review, no capture), failed IPN, query and refund.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';

import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';

import {
  basicOrderInput,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

const PARTNER_CODE = 'MOMO_TEST_PARTNER';
const ACCESS_KEY = 'momo-test-access-key';
const SECRET_KEY = 'momo-test-secret-key-0123456789';

const IPN_SIGN_FIELDS = [
  'accessKey',
  'amount',
  'extraData',
  'message',
  'orderId',
  'orderInfo',
  'orderType',
  'partnerCode',
  'payType',
  'requestId',
  'responseTime',
  'resultCode',
  'transId',
];
const ipnSignature = (payload) =>
  createHmac('sha256', SECRET_KEY)
    .update(IPN_SIGN_FIELDS.map((key) => `${key}=${payload[key] ?? ''}`).join('&'))
    .digest('hex');

// Fake MoMo gateway: verifies nothing itself (signature checks are the provider's job) but
// records calls and answers with the documented shapes.
const startFakeMomo = () => {
  const calls = { create: [], query: [], refund: [] };
  const transactions = new Map(); // orderId -> { transId, amount, resultCode }
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const payload = body ? JSON.parse(body) : {};
      const reply = (data) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (req.url === '/v2/gateway/api/create') {
        calls.create.push(payload);
        const transId = String(100000 + transactions.size);
        transactions.set(payload.orderId, { transId, amount: Number(payload.amount) });
        reply({
          partnerCode: payload.partnerCode,
          orderId: payload.orderId,
          requestId: payload.requestId,
          amount: Number(payload.amount),
          responseTime: Date.now(),
          message: 'Successful.',
          resultCode: 0,
          payUrl: `https://pay.fake-momo.test/${payload.orderId}`,
          deeplink: `momo://pay/${payload.orderId}`,
          qrCodeUrl: `https://qr.fake-momo.test/${payload.orderId}`,
        });
        return;
      }
      if (req.url === '/v2/gateway/api/query') {
        calls.query.push(payload);
        const tx = transactions.get(payload.orderId);
        if (!tx) return reply({ resultCode: 1005, message: 'order not found' });
        reply({
          partnerCode: payload.partnerCode,
          orderId: payload.orderId,
          requestId: payload.requestId,
          transId: tx.transId,
          amount: tx.amount,
          resultCode: 0,
          message: 'Successful.',
        });
        return;
      }
      if (req.url === '/v2/gateway/api/refund') {
        calls.refund.push(payload);
        if (calls.failNextRefund) {
          // Simulates a timeout after MoMo accepted it: no usable answer for the plugin.
          calls.failNextRefund = false;
          res.writeHead(502).end('bad gateway');
          return;
        }
        reply({
          partnerCode: payload.partnerCode,
          orderId: payload.orderId,
          requestId: payload.requestId,
          transId: `refund-${payload.transId}`,
          amount: Number(payload.amount),
          resultCode: 0,
          message: 'Successful.',
        });
        return;
      }
      res.writeHead(404).end('not found');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, calls, transactions, port: server.address().port }),
    );
  });
};

const fake = await startFakeMomo();
try {
  // Provider env must exist before the app boots — the plugin config loads at compile time.
  process.env.PORT ??= String(1400 + (process.pid % 500));
  process.env.ORDERING_PUBLIC_API_URL = `http://127.0.0.1:${process.env.PORT}`;
  process.env.MOMO_PARTNER_CODE = PARTNER_CODE;
  process.env.MOMO_ACCESS_KEY = ACCESS_KEY;
  process.env.MOMO_SECRET_KEY = SECRET_KEY;
  process.env.MOMO_ENVIRONMENT = 'sandbox';
  process.env.MOMO_BASE_URL = `http://127.0.0.1:${fake.port}`;

  await withApp(async (app) => {
    assert.equal(app.config.get('plugin::ordering').providers.payment.momo.enabled, true);
    assert.equal(app.config.get('plugin::ordering').publicApiUrl.includes('127.0.0.1'), true);
    const { order } = services(app);
    const payments = () => app.db.query('plugin::ordering.payment');
    const events = () => app.db.query('plugin::ordering.payment-event');
    const orders = () => app.db.query('plugin::ordering.order');
    await seedBranches(app);
    seedMenu(app);
    await app.db.query('plugin::ordering.branch').create({
      data: {
        code: 'M1',
        name: { vi: 'Chi nhánh ví', en: 'Wallet branch' },
        timezone: 'Asia/Ho_Chi_Minh',
        isActive: true,
        onlineOrdering: true,
        rank: 0,
        fulfillment: {
          pickup: {
            enabled: true,
            paymentTiming: 'prepay',
            paymentProviders: ['momo', 'cash'],
            schedule: { businessDayPolicy: { cutoffLocalTime: '04:00' } },
          },
        },
      },
    });
    await app.listen();
    // Read the bound port from the server itself — PORT in env/.env can disagree with it —
    // and point the wallet callbacks at the real listener.
    const base = `http://127.0.0.1:${app.server.httpServer.address().port}`;
    app.config.set('plugin::ordering.publicApiUrl', base);
    const momoIpn = async (payload, { signature } = {}) => {
      const res = await fetch(`${base}/api/v1/ordering/webhooks/momo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, signature: signature ?? ipnSignature(payload) }),
      });
      return { status: res.status, text: await res.text() };
    };

    // --- session create -----------------------------------------------------------
    const created = await order.createOrder(
      basicOrderInput({ locationRef: 'M1', receiveMethod: { kind: 'pickup', locationRef: 'M1' } }),
      systemCtx,
    );
    const session = async () => {
      const res = await fetch(`${base}/api/v1/ordering/payments/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Order-Token': created.publicToken },
        body: JSON.stringify({ provider: 'momo' }),
      });
      return { status: res.status, body: await res.json() };
    };
    const first = await session();
    assert.equal(first.status, 200);
    assert.equal(first.body.provider, 'momo');
    assert.ok(first.body.reference.startsWith(`${created.order.order.code}-`));
    assert.ok(first.body.redirectUrl.includes('pay.fake-momo.test'));
    assert.ok(first.body.deeplink.startsWith('momo://'));
    assert.equal(fake.calls.create.length, 1);
    assert.equal(fake.calls.create[0].amount, '195000');
    assert.equal(fake.calls.create[0].orderId, first.body.reference);
    assert.ok(fake.calls.create[0].signature.length === 64);
    assert.equal(fake.calls.create[0].ipnUrl, `${base}/api/v1/ordering/webhooks/momo`);
    // create body must carry the signed fixed field set — no PII beyond the order code.
    assert.equal(fake.calls.create[0].orderInfo.includes(created.order.order.code), true);

    const payment = await payments().findOne({
      where: { providerCode: 'momo', providerReference: first.body.reference },
    });
    assert.equal(payment.status, 'pending');
    assert.equal(Number(payment.requestedAmount), 195000);
    assert.equal(payment.session.payUrl, first.body.redirectUrl);
    assert.equal(payment.session.deeplink, first.body.deeplink);

    // A second press returns the same session — MoMo sees exactly one create call.
    const again = await session();
    assert.equal(again.status, 200);
    assert.equal(again.body.reference, first.body.reference);
    assert.equal(fake.calls.create.length, 1);

    // Unknown token and wrong provider are rejected before any MoMo call.
    const badToken = await fetch(`${base}/api/v1/ordering/payments/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Order-Token': 'A'.repeat(43) },
      body: JSON.stringify({ provider: 'momo' }),
    });
    assert.equal(badToken.status, 401);
    const wrongProvider = await fetch(`${base}/api/v1/ordering/payments/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Order-Token': created.publicToken },
      body: JSON.stringify({ provider: 'cash' }),
    });
    assert.equal(wrongProvider.status, 400);

    // --- signed IPN ---------------------------------------------------------------
    const reference = first.body.reference;
    const ipnPayload = {
      partnerCode: PARTNER_CODE,
      orderId: reference,
      requestId: randomUUID(),
      amount: 195000,
      orderInfo: `Thanh toan don hang ${created.order.order.code}`,
      orderType: 'momo_wallet',
      transId: 'momo-trans-1',
      resultCode: 0,
      message: 'Successful.',
      payType: 'qr',
      responseTime: Date.now(),
      extraData: '',
      accessKey: ACCESS_KEY,
    };
    const ipn = await momoIpn(ipnPayload);
    assert.equal(ipn.status, 204);
    const captured = await payments().findOne({ where: { id: payment.id } });
    assert.equal(captured.status, 'captured');
    assert.equal(Number(captured.capturedAmount), 195000);
    const row = await events().findOne({
      where: { providerCode: 'momo', providerTransactionId: 'momo-trans-1' },
    });
    assert.equal(row.reviewStatus, 'auto-matched');
    const orderAfter = await orders().findOne({ where: { id: created.order.order.id } });
    assert.equal(orderAfter.paymentStatus, 'paid');

    // Replay of the same transId: 204 again, still one event, no double capture.
    const replay = await momoIpn(ipnPayload);
    assert.equal(replay.status, 204);
    assert.equal(
      (await events().findMany({ where: { providerTransactionId: 'momo-trans-1' } })).length,
      1,
    );

    // Bad signature is the only 401; the payload never reaches matching.
    const bad = await momoIpn({ ...ipnPayload, transId: 'momo-trans-bad' }, { signature: '0'.repeat(64) });
    assert.equal(bad.status, 401);
    assert.equal(
      (await events().findMany({ where: { providerTransactionId: 'momo-trans-bad' } })).length,
      0,
    );

    // --- amount mismatch: stored for review, payment stays pending -----------------
    const second = await order.createOrder(
      basicOrderInput({ locationRef: 'M1', receiveMethod: { kind: 'pickup', locationRef: 'M1' } }),
      systemCtx,
    );
    const secondToken = second.publicToken;
    const secondSession = await fetch(`${base}/api/v1/ordering/payments/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Order-Token': secondToken },
      body: JSON.stringify({ provider: 'momo' }),
    });
    const secondRef = (await secondSession.json()).reference;
    const shortPaid = await momoIpn({
      ...ipnPayload,
      orderId: secondRef,
      transId: 'momo-trans-short',
      requestId: randomUUID(),
      amount: 100000,
    });
    assert.equal(shortPaid.status, 204);
    const shortPayment = await payments().findOne({ where: { providerReference: secondRef } });
    assert.equal(shortPayment.status, 'pending');
    const shortEvent = await events().findOne({
      where: { providerTransactionId: 'momo-trans-short' },
    });
    assert.equal(shortEvent.reviewStatus, 'needs-review');
    assert.equal(shortEvent.reviewReason, 'underpaid');
    const secondOrder = await orders().findOne({ where: { id: second.order.order.id } });
    assert.equal(secondOrder.paymentStatus, 'unpaid');

    // A terminal MoMo failure on the still-pending session marks the payment failed.
    const failed = await momoIpn({
      ...ipnPayload,
      orderId: secondRef,
      transId: 'momo-trans-failed',
      requestId: randomUUID(),
      amount: 195000,
      resultCode: 1006,
      message: 'Transaction rejected',
    });
    assert.equal(failed.status, 204);
    const failedPayment = await payments().findOne({ where: { providerReference: secondRef } });
    assert.equal(failedPayment.status, 'failed');

    // --- query + refund against the fake gateway ------------------------------------
    const provider = app.plugin('ordering').service('registry').paymentProvider('momo');
    const queried = await provider.queryTransaction(reference);
    assert.equal(queried.kind, 'capture');
    assert.equal(queried.providerTransactionId, fake.transactions.get(reference).transId);
    assert.equal(fake.calls.query.length >= 1, true);

    const { refund } = await services(app).refund.createRefund(
      {
        paymentId: captured.id,
        amount: 50000,
        reason: 'khách đổi ý',
        idempotencyKey: randomUUID(),
      },
      systemCtx,
    );
    // Written pending first; MoMo is called after commit by the outbox, with a stable id.
    assert.equal(refund.status, 'pending');
    assert.equal(Number(refund.amount), 50000);
    assert.match(refund.providerReference, /^RF[A-Z0-9]{18}$/);
    assert.equal(fake.calls.refund.length, 0, 'no provider call inside the refund transaction');
    fake.calls.failNextRefund = true;
    await runOutboxDispatcher(app, { owner: `momo-test:${process.pid}` });
    assert.equal(fake.calls.refund.length, 1);
    assert.equal((await app.db.query('plugin::ordering.refund').findOne({ where: { id: refund.id } })).status, 'pending');
    await app.db.connection('plugins_ordering_outbox').where({ unique_key: `refund.wallet-dispatch:${refund.id}` }).update({ available_at: new Date(Date.now() - 1000) });
    await runOutboxDispatcher(app, { owner: `momo-test:${process.pid}` });
    assert.equal(fake.calls.refund.length, 2);
    assert.equal(fake.calls.refund[1].orderId, refund.providerReference, 'the retry reuses the same refund id');
    assert.equal(fake.calls.refund[0].orderId, fake.calls.refund[1].orderId);
    assert.notEqual(fake.calls.refund[1].orderId, reference, 'a refund gets its own MoMo orderId');
    assert.equal(fake.calls.refund[1].amount, 50000);
    const settledRefund = await app.db.query('plugin::ordering.refund').findOne({ where: { id: refund.id } });
    assert.equal(settledRefund.status, 'settled');
    assert.equal(Number((await payments().findOne({ where: { id: captured.id } })).refundedAmount), 50000);

    // --- return URL is display-only -------------------------------------------------
    const ret = await fetch(
      `${base}/api/v1/ordering/payments/return/momo?orderId=${reference}&resultCode=0`,
    );
    assert.equal(ret.status, 200);
    const retBody = await ret.json();
    assert.equal(retBody.provider, 'momo');
    assert.equal(retBody.orderCode, created.order.order.code);
    assert.equal(retBody.status, 'captured');
    const unknownRef = await fetch(`${base}/api/v1/ordering/payments/return/momo?orderId=nope`);
    assert.equal(unknownRef.status, 404);


    // --- review fixes: wallet capture follows the order, not just the session ----------
    const openSession = async (token) => {
      const res = await fetch(`${base}/api/v1/ordering/payments/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Order-Token': token },
        body: JSON.stringify({ provider: 'momo' }),
      });
      return { status: res.status, body: await res.json() };
    };
    const placeM1 = () =>
      order.createOrder(basicOrderInput({ locationRef: 'M1', receiveMethod: { kind: 'pickup', locationRef: 'M1' } }), systemCtx);
    const capturePayload = (ref, transId) => ({ ...ipnPayload, orderId: ref, transId, requestId: randomUUID(), amount: 195000 });

    // A late IPN for a canceled order is never captured: the session was cancelled with the
    // order, and the IPN lands in review.
    const late = await placeM1();
    const lateRef = (await openSession(late.publicToken)).body.reference;
    await services(app).transition.cancelOrder({ orderId: late.order.order.id, reason: 'test' }, systemCtx);
    const latePayment = await payments().findOne({ where: { providerReference: lateRef } });
    assert.equal(latePayment.status, 'cancelled', 'closing the order cancels its pending wallet session');
    assert.equal((await momoIpn(capturePayload(lateRef, 'momo-late'))).status, 204);
    assert.equal((await payments().findOne({ where: { id: latePayment.id } })).status, 'cancelled');
    assert.equal((await events().findOne({ where: { providerTransactionId: 'momo-late' } })).reviewStatus, 'needs-review');
    const closedSession = await openSession(late.publicToken);
    assert.ok(closedSession.status >= 400, 'no wallet session on a closed order');

    // Paid another way first (here: the test provider), then the MoMo IPN arrives: review,
    // no second capture.
    const paidTwice = await placeM1();
    const twiceRef = (await openSession(paidTwice.publicToken)).body.reference;
    const other = await services(app).payment.createPayment({ orderId: paidTwice.order.order.id, providerCode: 'test' }, systemCtx);
    await services(app).payment.capturePayment(
      { paymentId: other.id, amount: other.requestedAmount, providerTransactionId: `other-${randomUUID()}` },
      systemCtx,
    );
    assert.equal((await momoIpn(capturePayload(twiceRef, 'momo-twice'))).status, 204);
    const twiceEvent = await events().findOne({ where: { providerTransactionId: 'momo-twice' } });
    assert.equal(twiceEvent.reviewStatus, 'needs-review');
    assert.equal(twiceEvent.reviewReason, 'already-paid');
    assert.notEqual((await payments().findOne({ where: { providerReference: twiceRef } })).status, 'captured');

    // Two failed IPNs without a transId keep the payment failed (no aborted transaction).
    const failing = await placeM1();
    const failRef = (await openSession(failing.publicToken)).body.reference;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await momoIpn({ ...capturePayload(failRef, '0'), resultCode: 1006, message: 'Transaction rejected' });
      assert.equal(res.status, 204);
    }
    assert.equal((await payments().findOne({ where: { providerReference: failRef } })).status, 'failed');
    assert.equal((await events().findMany({ where: { providerTransactionId: `momo-failed-${failRef}` } })).length, 1);
    console.log('[ordering-test] momo review fixes: closed order, paid elsewhere, repeated failures');

    console.log('[ordering-test] momo session, ipn capture/replay/mismatch/failed, refund, return');
  });
} finally {
  fake.server.close();
}
