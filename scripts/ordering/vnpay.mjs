// O13 step 3: VNPay wallet provider against a local fake of the gateway — no network call
// to VNPay. Covers signed pay URL, GET IPN {RspCode,Message} per outcome, replay, bad
// checksum, unknown ref, amount mismatch, failed txn, querydr and refund.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';

import {
  basicOrderInput,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

const TMN_CODE = 'VNPAYTEST1';
const HASH_SECRET = 'vnpay-test-hash-secret-0123456789abcdef';

const checksum = (params) =>
  createHmac('sha512', HASH_SECRET)
    .update(
      Object.keys(params)
        .filter((key) => key.startsWith('vnp_') && key !== 'vnp_SecureHash' && key !== 'vnp_SecureHashType' && params[key] !== '')
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join('&'),
    )
    .digest('hex');

const vnpayDate = (date) => {
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 19).replace(/[-:T]/g, '');
};

// Fake VNPay: only the merchant WebAPI endpoint exists (pay URL is built by us, not POSTed).
const startFakeVnpay = () => {
  const calls = { api: [] };
  const transactions = new Map(); // TxnRef -> { transactionNo, amount, status }
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const payload = body ? JSON.parse(body) : {};
      const reply = (data) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (req.url === '/merchant_webapi/api/transaction' && payload.vnp_Command === 'querydr') {
        calls.api.push(payload);
        const tx = transactions.get(payload.vnp_TxnRef);
        if (!tx) return reply({ vnp_ResponseCode: '91', vnp_Message: 'Transaction not found' });
        return reply({
          vnp_ResponseCode: '00',
          vnp_Message: 'Success',
          vnp_TmnCode: payload.vnp_TmnCode,
          vnp_TxnRef: payload.vnp_TxnRef,
          vnp_Amount: String(tx.amount * 100),
          vnp_TransactionNo: tx.transactionNo,
          vnp_TransactionStatus: tx.status,
          vnp_PayDate: tx.payDate ?? '',
        });
      }
      if (req.url === '/merchant_webapi/api/transaction' && payload.vnp_Command === 'refund') {
        calls.api.push(payload);
        return reply({
          vnp_ResponseCode: '00',
          vnp_Message: 'Success',
          vnp_TxnRef: payload.vnp_TxnRef,
          vnp_TransactionNo: payload.vnp_TransactionNo,
          vnp_Amount: payload.vnp_Amount,
        });
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

const fake = await startFakeVnpay();
try {
  process.env.PORT ??= String(1400 + (process.pid % 500));
  process.env.ORDERING_PUBLIC_API_URL = `http://127.0.0.1:${process.env.PORT}`;
  process.env.VNPAY_TMN_CODE = TMN_CODE;
  process.env.VNPAY_HASH_SECRET = HASH_SECRET;
  process.env.VNPAY_ENVIRONMENT = 'sandbox';
  process.env.VNPAY_BASE_URL = `http://127.0.0.1:${fake.port}`;

  await withApp(async (app) => {
    const { order } = services(app);
    const payments = () => app.db.query('plugin::ordering.payment');
    const events = () => app.db.query('plugin::ordering.payment-event');
    const orders = () => app.db.query('plugin::ordering.order');
    await seedBranches(app);
    seedMenu(app);
    await app.db.query('plugin::ordering.branch').create({
      data: {
        code: 'V1',
        name: { vi: 'Chi nhánh VNPay', en: 'VNPay branch' },
        timezone: 'Asia/Ho_Chi_Minh',
        isActive: true,
        onlineOrdering: true,
        rank: 0,
        fulfillment: {
          pickup: {
            enabled: true,
            paymentTiming: 'prepay',
            paymentProviders: ['vnpay', 'cash'],
            schedule: { businessDayPolicy: { cutoffLocalTime: '04:00' } },
          },
        },
      },
    });
    await app.listen();
    const base = `http://127.0.0.1:${app.server.httpServer.address().port}`;
    app.config.set('plugin::ordering.publicApiUrl', base);

    const ipn = async (params, { tampered } = {}) => {
      const signed = { ...params, vnp_SecureHash: tampered ?? checksum(params) };
      const query = Object.keys(signed)
        .sort()
        .map((key) => `${key}=${encodeURIComponent(signed[key])}`)
        .join('&');
      const res = await fetch(`${base}/api/v1/ordering/webhooks/vnpay?${query}`);
      return { status: res.status, body: await res.json() };
    };

    // --- session create: pay URL is signed params, no HTTP call ----------------------
    const created = await order.createOrder(
      basicOrderInput({ locationRef: 'V1', receiveMethod: { kind: 'pickup', locationRef: 'V1' } }),
      systemCtx,
    );
    const sessionRes = await fetch(`${base}/api/v1/ordering/payments/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Order-Token': created.publicToken },
      body: JSON.stringify({ provider: 'vnpay' }),
    });
    assert.equal(sessionRes.status, 200);
    const session = await sessionRes.json();
    assert.equal(session.provider, 'vnpay');
    const reference = session.reference;
    assert.ok(reference.startsWith(`${created.order.order.code}-`));
    const payUrl = new URL(session.redirectUrl);
    assert.equal(payUrl.host, `127.0.0.1:${fake.port}`);
    assert.equal(payUrl.pathname, '/paymentv2/vpcpay.html');
    const payParams = Object.fromEntries(payUrl.searchParams.entries());
    assert.equal(payParams.vnp_TmnCode, TMN_CODE);
    assert.equal(payParams.vnp_TxnRef, reference);
    assert.equal(payParams.vnp_Amount, '19500000');
    assert.equal(payParams.vnp_Version, '2.1.0');
    assert.equal(payParams.vnp_IpnUrl, `${base}/api/v1/ordering/webhooks/vnpay`);
    // The pay URL's own checksum verifies against the decoded param values.
    const { vnp_SecureHash: presented, ...unsigned } = payParams;
    assert.equal(checksum(unsigned), presented);

    const payment = await payments().findOne({
      where: { providerCode: 'vnpay', providerReference: reference },
    });
    assert.equal(payment.status, 'pending');
    assert.ok(payment.session.vnpCreateDate);

    // --- signed IPN via GET ----------------------------------------------------------
    const txnNo = 'VNPTXN-001';
    fake.transactions.set(reference, {
      transactionNo: txnNo,
      amount: 195000,
      status: '00',
      payDate: vnpayDate(new Date()),
    });
    const ipnParams = {
      vnp_Amount: '19500000',
      vnp_BankCode: 'NCB',
      vnp_CardType: 'ATM',
      vnp_OrderInfo: `Thanh toan don hang ${created.order.order.code}`,
      vnp_PayDate: vnpayDate(new Date()),
      vnp_ResponseCode: '00',
      vnp_TmnCode: TMN_CODE,
      vnp_TransactionNo: txnNo,
      vnp_TransactionStatus: '00',
      vnp_TxnRef: reference,
    };
    const first = await ipn(ipnParams);
    assert.deepEqual(first.body, { RspCode: '00', Message: 'Confirm Success' });
    const captured = await payments().findOne({ where: { id: payment.id } });
    assert.equal(captured.status, 'captured');
    assert.equal(Number(captured.capturedAmount), 195000);
    assert.equal(captured.session.transactionNo, txnNo);
    const orderAfter = await orders().findOne({ where: { id: created.order.order.id } });
    assert.equal(orderAfter.paymentStatus, 'paid');

    // Replay → 02, still one event row.
    const replay = await ipn(ipnParams);
    assert.deepEqual(replay.body, { RspCode: '02', Message: 'Order already confirmed' });
    assert.equal(
      (await events().findMany({ where: { providerTransactionId: txnNo } })).length,
      1,
    );

    // Bad checksum → 97, nothing stored.
    const bad = await ipn({ ...ipnParams, vnp_TransactionNo: 'VNPTXN-BAD' }, { tampered: 'f'.repeat(128) });
    assert.equal(bad.body.RspCode, '97');
    assert.equal(
      (await events().findMany({ where: { providerTransactionId: 'VNPTXN-BAD' } })).length,
      0,
    );

    // Unknown reference → 01. Wrong amount → 04 + review, never captured.
    const unknown = await ipn({ ...ipnParams, vnp_TransactionNo: 'VNPTXN-X', vnp_TxnRef: 'NOPE-1' });
    assert.equal(unknown.body.RspCode, '01');

    const second = await order.createOrder(
      basicOrderInput({ locationRef: 'V1', receiveMethod: { kind: 'pickup', locationRef: 'V1' } }),
      systemCtx,
    );
    const secondSession = await (
      await fetch(`${base}/api/v1/ordering/payments/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Order-Token': second.publicToken },
        body: JSON.stringify({ provider: 'vnpay' }),
      })
    ).json();
    const secondRef = secondSession.reference;
    const shortPaid = await ipn({
      ...ipnParams,
      vnp_TxnRef: secondRef,
      vnp_TransactionNo: 'VNPTXN-SHORT',
      vnp_Amount: '10000000',
    });
    assert.equal(shortPaid.body.RspCode, '04');
    const shortPayment = await payments().findOne({ where: { providerReference: secondRef } });
    assert.equal(shortPayment.status, 'pending');
    const shortEvent = await events().findOne({ where: { providerTransactionId: 'VNPTXN-SHORT' } });
    assert.equal(shortEvent.reviewStatus, 'needs-review');
    assert.equal(shortEvent.reviewReason, 'underpaid');

    // Customer cancelled at VNPay (24) → ACK 00, payment marked failed.
    const cancelled = await ipn({
      ...ipnParams,
      vnp_TxnRef: secondRef,
      vnp_TransactionNo: 'VNPTXN-CANCEL',
      vnp_ResponseCode: '24',
      vnp_TransactionStatus: '02',
      vnp_Amount: '19500000',
    });
    assert.equal(cancelled.body.RspCode, '00');
    const failedPayment = await payments().findOne({ where: { providerReference: secondRef } });
    assert.equal(failedPayment.status, 'failed');

    // --- querydr + refund --------------------------------------------------------------
    const provider = app.plugin('ordering').service('registry').paymentProvider('vnpay');
    const sessionRow = await payments().findOne({ where: { id: payment.id } });
    const queried = await provider.queryTransaction(reference, { session: sessionRow.session });
    assert.equal(queried.kind, 'capture');
    assert.equal(queried.providerTransactionId, txnNo);
    const queryCall = fake.calls.api.find((call) => call.vnp_Command === 'querydr');
    assert.equal(queryCall.vnp_TxnRef, reference);
    assert.equal(queryCall.vnp_TransactionDate, sessionRow.session.vnpCreateDate);
    assert.equal(queryCall.vnp_SecureHash.length, 128);

    const { refund } = await services(app).refund.createRefund(
      {
        paymentId: payment.id,
        amount: 50000,
        reason: 'đổi ý',
        idempotencyKey: `rf-${randomUUID()}`,
      },
      systemCtx,
    );
    assert.equal(refund.status, 'settled');
    const refundCall = fake.calls.api.find((call) => call.vnp_Command === 'refund');
    assert.equal(refundCall.vnp_TxnRef, reference);
    assert.equal(refundCall.vnp_TransactionNo, txnNo);
    assert.equal(refundCall.vnp_TransactionType, '03');
    assert.equal(refundCall.vnp_Amount, '5000000');

    // --- return URL: display only -------------------------------------------------------
    const ret = await fetch(
      `${base}/api/v1/ordering/payments/return/vnpay?vnp_TxnRef=${reference}&vnp_ResponseCode=00&vnp_SecureHash=fake`,
    );
    assert.equal(ret.status, 200);
    const retBody = await ret.json();
    assert.equal(retBody.orderCode, created.order.order.code);
    assert.equal(retBody.status, 'captured');
    // Tampered/absent hash on the return URL changes nothing and still resolves.
    const retUnknown = await fetch(`${base}/api/v1/ordering/payments/return/vnpay?vnp_TxnRef=nope`);
    assert.equal(retUnknown.status, 404);

    console.log('[ordering-test] vnpay pay-url, ipn rsp codes, querydr, refund, return');
  });
} finally {
  fake.server.close();
}
