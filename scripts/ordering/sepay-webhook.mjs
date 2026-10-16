// O4 step 3: signed SePay webhook. ACK body is exactly { success: true } after the raw event
// is stored, including a replay of the same id and transferType=out. A bad signature or a
// stale timestamp is the rejection. No network call to SePay.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { withApp } from './_harness.mjs';

const sign = (secret, timestamp, rawBody) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

withApp(async (app) => {
  const secret = app.config.get('plugin::ordering').providers.payment.sepay.webhookSecret;
  assert.equal(typeof secret, 'string');
  assert.ok(secret.length >= 16);

  await app.listen();
  const url = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering/webhooks/sepay`;
  const events = () => app.db.query('plugin::ordering.payment-event');
  const payments = () => app.db.query('plugin::ordering.payment');

  const post = async (payload, { timestamp, signature, raw } = {}) => {
    const body = raw ?? JSON.stringify(payload);
    const ts = timestamp ?? String(Math.floor(Date.now() / 1000));
    const sig = signature === undefined ? `sha256=${sign(secret, ts, body)}` : signature;
    const headers = { 'Content-Type': 'application/json', 'X-SePay-Timestamp': ts };
    if (sig !== null) headers['X-SePay-Signature'] = sig;
    const res = await fetch(url, { method: 'POST', headers, body });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  const inbound = {
    id: 42,
    gateway: 'MBBank',
    transactionDate: '2026-10-11 19:00:00',
    accountNumber: '0123456789',
    content: 'chuyen khoan',
    transferType: 'in',
    transferAmount: 175000,
    referenceCode: 'FT42',
  };

  const first = await post(inbound);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { success: true });
  const rows = await events().findMany({ where: { providerCode: 'sepay', providerTransactionId: '42' } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reviewStatus, 'needs-review');
  assert.equal(rows[0].reviewReason, 'no-code');
  assert.equal(Number(rows[0].amount), 175000);
  assert.equal(rows[0].transferType, 'in');
  const outbox = await app.db.query('plugin::ordering.outbox').findMany({
    where: { type: 'payment.event.received', aggregateId: String(rows[0].id) },
  });
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].uniqueKey, 'payment-event:sepay:42');

  const replay = await post(inbound);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, { success: true });
  const afterReplay = await events().findMany({ where: { providerTransactionId: '42' } });
  assert.equal(afterReplay.length, 1);
  const outboxAfter = await app.db.query('plugin::ordering.outbox').findMany({
    where: { uniqueKey: 'payment-event:sepay:42' },
  });
  assert.equal(outboxAfter.length, 1);

  const raw = JSON.stringify({ ...inbound, id: 43 });
  const bad = await post(null, { raw: `${raw} `, signature: `sha256=${sign(secret, String(Math.floor(Date.now() / 1000)), raw)}` });
  assert.equal(bad.status, 401);
  assert.deepEqual(bad.body, { success: false });
  assert.equal((await events().findMany({ where: { providerTransactionId: '43' } })).length, 0);

  const staleTs = String(Math.floor(Date.now() / 1000) - 301);
  const staleRaw = JSON.stringify({ ...inbound, id: 44 });
  const stale = await post(null, {
    raw: staleRaw,
    timestamp: staleTs,
    signature: `sha256=${sign(secret, staleTs, staleRaw)}`,
  });
  assert.equal(stale.status, 401);
  assert.deepEqual(stale.body, { success: false });
  assert.equal((await events().findMany({ where: { providerTransactionId: '44' } })).length, 0);

  const missing = await post({ ...inbound, id: 45 }, { signature: null });
  assert.equal(missing.status, 401);
  assert.deepEqual(missing.body, { success: false });

  const junkRaw = '{"nope":true}';
  const ts = String(Math.floor(Date.now() / 1000));
  const junk = await post(null, { raw: junkRaw, timestamp: ts, signature: `sha256=${sign(secret, ts, junkRaw)}` });
  assert.equal(junk.status, 400);
  assert.deepEqual(junk.body, { success: false });

  const moneyOut = await post({
    id: 46,
    transferType: 'out',
    transferAmount: 50000,
    accountNumber: '0123456789',
    content: 'internal move',
  });
  assert.equal(moneyOut.status, 200);
  assert.deepEqual(moneyOut.body, { success: true });
  const outRow = await events().findOne({ where: { providerTransactionId: '46' } });
  assert.equal(outRow.reviewStatus, 'ignored');
  assert.equal(outRow.reviewReason, null);
  assert.equal(outRow.transferType, 'out');
  assert.equal((await payments().findMany()).length, 0);

  // A code no provider answers to is a client error, never a 500: the route is public, so an
  // unconfigured provider (SePay env unset) must not raise server errors for anyone who calls it.
  const unknownUrl = url.replace('/webhooks/sepay', '/webhooks/not-a-provider');
  const unknown = await fetch(unknownUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error.code, 'WEBHOOK_PROVIDER_UNKNOWN');

  console.log('[ordering-test] sepay webhook ack, replay, reject, money-out, unknown provider 404');
});
