// O13 step 4: wallet-status-check job — pending sessions are polled via the provider's
// query API when the IPN never arrives. Runs against a fake MoMo gateway; no real network.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { hostname } from 'node:os';

import { runWalletStatusCheck } from '../../src/plugins/ordering/dist/server/src/jobs/wallet-status.js';
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

const startFakeMomo = () => {
  const calls = { query: [] };
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
        const transId = `tx-${transactions.size + 1}`;
        transactions.set(payload.orderId, { transId, amount: Number(payload.amount), resultCode: 0 });
        reply({ resultCode: 0, message: 'ok', payUrl: `https://pay.fake-momo.test/${payload.orderId}`, orderId: payload.orderId, requestId: payload.requestId });
        return;
      }
      if (req.url === '/v2/gateway/api/query') {
        calls.query.push(payload);
        const tx = transactions.get(payload.orderId);
        if (!tx) return reply({ resultCode: 1005, message: 'not found' });
        reply({
          resultCode: tx.resultCode,
          transId: tx.resultCode === 0 ? tx.transId : '',
          amount: tx.amount,
          orderId: payload.orderId,
          requestId: payload.requestId,
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
  process.env.PORT ??= String(1400 + (process.pid % 500));
  process.env.ORDERING_PUBLIC_API_URL = `http://127.0.0.1:${process.env.PORT}`;
  process.env.MOMO_PARTNER_CODE = PARTNER_CODE;
  process.env.MOMO_ACCESS_KEY = ACCESS_KEY;
  process.env.MOMO_SECRET_KEY = SECRET_KEY;
  process.env.MOMO_BASE_URL = `http://127.0.0.1:${fake.port}`;

  await withApp(async (app) => {
    const { order } = services(app);
    const payments = () => app.db.query('plugin::ordering.payment');
    await seedBranches(app);
    seedMenu(app);
    await app.db.query('plugin::ordering.branch').create({
      data: {
        code: 'W1',
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
    const base = `http://127.0.0.1:${app.server.httpServer.address().port}`;
    app.config.set('plugin::ordering.publicApiUrl', base);

    const openSession = async () => {
      const created = await order.createOrder(
        basicOrderInput({ locationRef: 'W1', receiveMethod: { kind: 'pickup', locationRef: 'W1' } }),
        systemCtx,
      );
      const res = await fetch(`${base}/api/v1/ordering/payments/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Order-Token': created.publicToken },
        body: JSON.stringify({ provider: 'momo' }),
      });
      assert.equal(res.status, 200);
      return (await res.json()).reference;
    };

    const owner = `${hostname()}:${process.pid}`;
    // `now` ahead of the 60s grace window so a just-created session is in scope.
    const later = new Date(Date.now() + 120_000);

    // --- pending → capture via query when the IPN is late -----------------------------
    const refA = await openSession();
    const paid = await runWalletStatusCheck(app, { owner, now: later });
    assert.equal(paid.ran, true);
    assert.equal(paid.checked, 1);
    assert.equal(paid.applied, 1);
    const paymentA = await payments().findOne({ where: { providerReference: refA } });
    assert.equal(paymentA.status, 'captured');
    assert.equal(Number(paymentA.capturedAmount), 195000);
    const eventRow = await app.db
      .query('plugin::ordering.payment-event')
      .findOne({ where: { providerCode: 'momo', providerTransactionId: 'tx-1' } });
    assert.equal(eventRow.reviewStatus, 'auto-matched');

    // --- still processing at MoMo → stays pending --------------------------------------
    const refB = await openSession();
    fake.transactions.get(refB).resultCode = 1000; // processing
    const processing = await runWalletStatusCheck(app, { owner, now: later });
    assert.equal(processing.checked, 1);
    assert.equal(processing.applied, 0);
    const paymentB = await payments().findOne({ where: { providerReference: refB } });
    assert.equal(paymentB.status, 'pending');

    // --- terminal failure at MoMo → payment failed ---------------------------------------
    fake.transactions.get(refB).resultCode = 1006; // rejected
    const failed = await runWalletStatusCheck(app, { owner, now: later });
    assert.equal(failed.applied, 1);
    const paymentBAfter = await payments().findOne({ where: { providerReference: refB } });
    assert.equal(paymentBAfter.status, 'failed');

    // Re-run: no pending rows left → nothing checked, nothing double-applies.
    const idle = await runWalletStatusCheck(app, { owner, now: later });
    assert.equal(idle.checked, 0);
    assert.equal(idle.applied, 0);

    console.log('[ordering-test] wallet-status job: capture, processing→pending, failed, idle');
  });
} finally {
  fake.server.close();
}
