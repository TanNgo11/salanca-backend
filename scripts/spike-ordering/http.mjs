// O0 probe (checks 11, 12, 19) against a running Strapi:
// - plugin content types expose no REST route besides the routes the plugin declares;
// - CORS preflight allows X-Order-Token and Idempotency-Key for a configured frontend origin;
// - the webhook refuses to verify when the raw body is unavailable.
import assert from 'node:assert/strict';

import { loadSpikeApp } from './runtime.mjs';

const port = 1398;
process.env.PORT = String(port);
const origin = 'http://localhost:3000';
process.env.FRONTEND_URLS = origin;
const app = await loadSpikeApp(true);
const base = `http://127.0.0.1:${port}`;
try {
  await app.start();

  const pluginRoutes = app.server.listRoutes()
    .filter((route) => route.path.includes('ordering') && !route.path.startsWith('/ordering/'))
    .map((route) => `${route.methods.join(',')} ${route.path}`);
  console.log('[spike] public routes mounted by the plugin:', JSON.stringify(pluginRoutes));
  assert.deepEqual(pluginRoutes, ['POST /api/v1/ordering/webhooks/spike']);

  for (const path of [
    '/api/v1/orders', '/api/v1/ordering/orders', '/api/v1/ordering/order',
    '/api/v1/catalog-products', '/api/v1/ordering/catalog-products', '/api/v1/ordering/staff-location-scopes',
  ]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404, `${path} must not exist`);
  }
  console.log('[spike] no generated REST route for any plugin content type (6 guessed paths → 404)');

  const preflight = await fetch(`${base}/api/v1/ordering/webhooks/spike`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'x-order-token,idempotency-key,content-type',
    },
  });
  const allowed = (preflight.headers.get('access-control-allow-headers') ?? '').toLowerCase();
  assert.ok(preflight.status < 300, `preflight status ${preflight.status}`);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.ok(allowed.includes('x-order-token') && allowed.includes('idempotency-key'), allowed);
  console.log(`[spike] CORS preflight ${preflight.status}: allow-headers "${allowed}"`);

  const noRaw = await fetch(`${base}/api/v1/ordering/webhooks/spike`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('opaque'),
  });
  assert.equal(noRaw.status, 500);
  assert.equal((await noRaw.json()).error, 'RAW_BODY_UNAVAILABLE');
  console.log('[spike] webhook without a raw body → 500 RAW_BODY_UNAVAILABLE (never re-serializes JSON)');
} finally {
  await app.destroy();
}
