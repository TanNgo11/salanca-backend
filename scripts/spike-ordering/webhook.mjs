import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { loadSpikeApp } from './runtime.mjs';

process.env.ORDERING_SPIKE_ENABLED = 'true';
const port = 1397;
process.env.PORT = String(port);
const app = await loadSpikeApp(true);
try {
  await app.start();
  const raw = '{"probe":"O0","value":1}';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = process.env.ORDERING_SPIKE_SECRET;
  const signature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}`;
  const headers = { 'content-type': 'application/json', 'x-spike-timestamp': timestamp, 'x-spike-signature': signature };
  const good = await fetch(`http://127.0.0.1:${port}/api/v1/ordering/webhooks/spike`, { method: 'POST', headers, body: raw });
  assert.equal(good.status, 200, await good.text());
  const bad = await fetch(`http://127.0.0.1:${port}/api/v1/ordering/webhooks/spike`, { method: 'POST', headers, body: '{"probe":"tampered"}' });
  assert.equal(bad.status, 401);
  console.log('[spike] webhook raw-body HMAC: valid 200; one-byte mutation 401');
} finally { await app.destroy(); }
