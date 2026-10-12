import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import http from 'node:http';

import { PUBLIC_EVENT_TYPES } from '../../src/plugins/ordering/dist/server/src/domain/webhooks/events.js';
import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import { runWebhookDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/webhook-dispatcher.js';
import { RETRY_SCHEDULE_SECONDS } from '../../src/plugins/ordering/dist/server/src/services/webhook-delivery.js';
import { basicOrderInput, seedBranches, seedMenu, systemCtx, withApp } from './_harness.mjs';

// O10 step 3: outbound webhooks end to end — the outbox fanout writes one pending delivery per
// subscribed endpoint, the dispatcher POSTs the exact raw body with the X-Ordering-Signature
// header, retries on the fixed schedule, times out, auto-disables a dead endpoint with an
// ops-alert, and never sends PII unless includeCustomer is on.

const sign = (secret, timestamp, body) =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');

withApp(async (app) => {
  // Local receiver needs http + a loopback exemption — test-only config, production stays https.
  app.config.set('plugin::ordering.webhooks.allowHttp', true);
  app.config.set('plugin::ordering.webhooks.allowHosts', ['127.0.0.1']);
  app.config.set('plugin::ordering.webhooks.timeoutMs', 800);

  const received = [];
  const receiver = { mode: 'ok' };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        path: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      if (receiver.mode === 'hang') return; // client times out
      res.statusCode = receiver.mode === 'fail' ? 500 : 200;
      res.end('{}');
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const url = `http://127.0.0.1:${server.address().port}/hook?sub=1`;
    const plugin = app.plugin('ordering');
    const endpointService = plugin.service('webhook-endpoint');
    const deliveryService = plugin.service('webhook-delivery');
    const deliveries = () => app.db.query('plugin::ordering.webhook-delivery');
    const endpoints = () => app.db.query('plugin::ordering.webhook-endpoint');
    const dispatch = () => runOutboxDispatcher(app, { owner: `test:${process.pid}` });
    const send = () => runWebhookDispatcher(app, { owner: `test:${process.pid}` });

    const plain = await endpointService.create(
      { url, events: PUBLIC_EVENT_TYPES, description: 'no PII' },
      systemCtx,
    );
    const withCustomer = await endpointService.create(
      { url, events: ['order.created'], includeCustomer: true },
      systemCtx,
    );
    assert.match(plain.secret, /^whsec_/, 'secret shown once at create');
    const view = await endpointService.list(systemCtx);
    assert.ok(!JSON.stringify(view).includes(plain.secret), 'list view never carries secrets');

    await seedBranches(app);
    seedMenu(app);
    const placed = await plugin.service('order').createOrder(basicOrderInput(), systemCtx);
    const orderId = placed.order.order.id;
    const orderCode = placed.order.order.code;
    await dispatch(); // outbox → fanout writes pending deliveries

    let rows = await deliveries().findMany({ orderBy: { id: 'asc' } });
    assert.equal(rows.length, 2, 'one delivery per subscribed endpoint for order.created');
    assert.ok(rows.every((row) => row.status === 'pending' && row.attempts === 0));

    // --- Signed delivery -------------------------------------------------------------------
    let result = await send();
    assert.equal(result.delivered, 2);
    assert.equal(received.length, 2);
    const first = received[0];
    assert.equal(first.headers['x-ordering-event'], 'order.created');
    assert.equal(first.headers['content-type'], 'application/json');
    assert.equal(first.path, '/hook?sub=1', 'full url including query is used for the request');
    const sigHeader = first.headers['x-ordering-signature'];
    const t = Number(/^t=(\d+),/.exec(sigHeader)?.[1]);
    assert.ok(t > 0, 'signature header carries a timestamp');
    const v1s = [...sigHeader.matchAll(/v1=([0-9a-f]{64})/g)].map((m) => m[1]);
    assert.ok(v1s.includes(sign(plain.secret, t, first.body)), 'HMAC over t.rawBody verifies');

    const envelope = JSON.parse(first.body);
    assert.equal(envelope.apiVersion, '2026-10');
    assert.equal(envelope.type, 'order.created');
    assert.equal(String(envelope.id), first.headers['x-ordering-delivery']);
    assert.equal(envelope.data.code, orderCode);
    assert.ok(envelope.occurredAt);
    assert.ok(!('customer' in envelope.data), 'PII-free by default');
    assert.ok(!first.body.includes('9000000001') && !first.body.includes('Khách'), 'no name/phone');

    const withCustomerBody = received.find((r) => JSON.parse(r.body).data.customer !== undefined);
    assert.ok(withCustomerBody, 'includeCustomer endpoint received customer data');
    const cust = JSON.parse(withCustomerBody.body).data.customer;
    assert.equal(cust.name, 'Khách test');
    assert.equal(cust.phone, '+84900000001');

    rows = await deliveries().findMany({});
    assert.ok(rows.every((row) => row.status === 'succeeded' && row.succeededAt));

    // --- Fanout dedupe: re-dispatching the outbox event must not create a second row ---------
    const outboxEvent = (
      await app.db.query('plugin::ordering.outbox').findMany({ where: { type: 'order.created' } })
    ).find((row) => row.payload.orderId === orderId);
    await deliveryService.fanout({ ...outboxEvent, id: String(outboxEvent.id) });
    assert.equal(
      (await deliveries().findMany({ where: { eventId: String(outboxEvent.id) } })).length,
      2,
      'replayed fanout stays idempotent per (endpoint, event)',
    );

    // --- Failure → fixed schedule ------------------------------------------------------------
    receiver.mode = 'fail';
    const second = await plugin.service('order').createOrder(basicOrderInput(), systemCtx);
    await dispatch();
    const before = Date.now();
    result = await send();
    assert.equal(result.retried, 2);
    rows = await deliveries().findMany({
      where: { status: 'pending', attempts: { $gt: 0 } },
      orderBy: { id: 'asc' },
    });
    for (const row of rows) {
      assert.equal(row.attempts, 1);
      assert.equal(row.lastStatusCode, 500);
      const delayMs = new Date(row.nextAttemptAt).getTime() - before;
      assert.ok(
        delayMs > RETRY_SCHEDULE_SECONDS[0] * 1000 - 30_000 &&
          delayMs < RETRY_SCHEDULE_SECONDS[0] * 1000 + 60_000,
        'first retry scheduled at ~1 minute',
      );
    }
    assert.equal(
      (await endpoints().findOne({ where: { id: plain.endpoint.id } })).consecutiveFailures,
      1,
      'endpoint failure counter advanced',
    );

    // --- resend while pending stays claimed-safe; manual resend resets a failed row -----------
    await deliveryService.resend(rows[0].id, systemCtx);

    // --- Timeout is a retryable failure --------------------------------------------------------
    receiver.mode = 'hang';
    const third = await plugin.service('order').createOrder(basicOrderInput(), systemCtx);
    await dispatch();
    result = await send();
    // 2 deliveries for the new order + the resent row — all three hang and are retried.
    assert.equal(result.retried, 3, 'hung receiver → timeout counts as a failure');
    const timedOut = (
      await deliveries().findMany({
        where: { eventType: 'order.created' },
        orderBy: { id: 'desc' },
        limit: 1,
      })
    )[0];
    assert.ok(timedOut.lastError, 'timeout leaves an error code');

    // --- Auto-disable + alert -------------------------------------------------------------------
    app.config.set('plugin::ordering.webhooks.disableAfterFailures', 4);
    receiver.mode = 'fail';
    // 4th consecutive failure on both endpoints (withCustomer only saw order.created twice +
    // the resend row's retries contribute to plain.endpoint's counter on every attempt).
    for (let i = 0; i < 6; i += 1) {
      // Bind a JS date (ms precision) rather than pg now() — a server-side now() writes
      // microseconds (.238492) that would land strictly after the claim's ms-precision
      // bind (.238000) and the row would look not-yet-due.
      await app.db.connection.raw(
        `UPDATE plugins_ordering_webhook_delivery
           SET status = 'pending', next_attempt_at = ? WHERE status = 'pending'`,
        [new Date(Date.now() - 1000)],
      );
      await send();
    }
    const endpointRow = await endpoints().findOne({ where: { id: plain.endpoint.id } });
    assert.equal(endpointRow.active, false, 'endpoint auto-disabled after repeated failures');
    assert.equal(endpointRow.disabledReason, 'auto-failures');
    const alert = await app.db
      .query('plugin::ordering.ops-alert')
      .findOne({ where: { alertCode: 'webhook-endpoint-disabled' } });
    assert.ok(alert, 'webhook-endpoint-disabled alert raised');
    assert.equal(alert.dedupeKey, `webhook-endpoint:${plain.endpoint.id}`);

    // Disabled endpoint: its deliveries die instead of being retried.
    rows = await deliveries().findMany({ where: { endpointId: plain.endpoint.id, status: 'pending' } });
    assert.equal(rows.length, 0, 'no pending work left on a disabled endpoint');

    // --- sendTest: synchronous ping --------------------------------------------------------------
    const other = await endpointService.create({ url, events: ['order.created'] }, systemCtx);
    receiver.mode = 'ok';
    const ping = await deliveryService.sendTest(other.endpoint.id, systemCtx);
    assert.equal(ping.ok, true);
    assert.equal(ping.statusCode, 200);
    const pingRow = await deliveries().findOne({ where: { id: ping.deliveryId } });
    assert.equal(pingRow.eventType, 'ordering.ping');
    assert.equal(pingRow.status, 'succeeded');
    const lastRequest = received.at(-1);
    assert.equal(lastRequest.headers['x-ordering-event'], 'ordering.ping');
    assert.equal(JSON.parse(lastRequest.body).data.ping, true);

    // --- Rotation: both secrets sign during the grace window -------------------------------------
    const rotated = await endpointService.rotateSecret(other.endpoint.id, systemCtx);
    assert.match(rotated.secret, /^whsec_/);
    const ping2 = await deliveryService.sendTest(other.endpoint.id, systemCtx);
    assert.equal(ping2.ok, true);
    const rotatedRequest = received.at(-1);
    const rt = Number(/^t=(\d+),/.exec(rotatedRequest.headers['x-ordering-signature'])?.[1]);
    const rv1s = [...rotatedRequest.headers['x-ordering-signature'].matchAll(/v1=([0-9a-f]{64})/g)]
      .map((m) => m[1]);
    assert.equal(rv1s.length, 2, 'current + previous secret both sign during grace');
    assert.ok(rv1s.includes(sign(rotated.secret, rt, rotatedRequest.body)));
    assert.ok(rv1s.includes(sign(other.secret, rt, rotatedRequest.body)));

    console.log(
      '[ordering-test] webhooks-out: fanout, signature, PII filter, schedule, timeout, auto-disable, resend, ping, rotation verified',
    );
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});
