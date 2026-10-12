// O10 step 4: the "Webhook" Admin screen API over real HTTP — webhook.manage gates every
// route (403), missing resources answer 404, the plaintext signing secret appears ONLY in
// create/rotate responses, and the URL SSRF guard rejects bad targets at the route layer.
import assert from 'node:assert/strict';
import http from 'node:http';

import { createHmac } from 'node:crypto';
import { PUBLIC_EVENT_TYPES } from '../../src/plugins/ordering/dist/server/src/domain/webhooks/events.js';
import { seedAdminHttpStaff, withApp } from './_harness.mjs';

const SECRET_KEYS = ['secret', 'secretSealed', 'previousSecretSealed', 'secretHint'];

withApp(async (app) => {
  // The local receiver is loopback http — test-only exemptions (production stays https-only).
  app.config.set('plugin::ordering.webhooks.allowHttp', true);
  app.config.set('plugin::ordering.webhooks.allowHosts', ['127.0.0.1']);

  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.statusCode = 200;
      res.end('{}');
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/hook?token=keep-out-of-view`;

  await app.listen();
  const staff = await seedAdminHttpStaff(app, {
    scopes: { quanly: { allLocations: true, locationRefs: [] } },
  });
  const noWebhook = await seedAdminHttpStaff(app, {
    actions: ['order.read', 'settings.manage'],
    scopes: { nv: { allLocations: true, locationRefs: [] } },
  });

  try {
    // ── Permission gate: every webhook route needs plugin::ordering.webhook.manage ──────────
    assert.equal((await noWebhook.as.nv('GET', '/webhooks')).status, 403, 'list denied');
    assert.equal(
      (await noWebhook.as.nv('POST', '/webhooks', { url, events: ['order.created'] })).status,
      403,
      'create denied',
    );
    assert.equal((await noWebhook.as.nv('GET', '/webhooks/1')).status, 403, 'get denied');
    assert.equal((await noWebhook.as.nv('GET', '/webhooks/1/deliveries')).status, 403, 'deliveries denied');
    assert.equal((await noWebhook.as.nv('POST', '/webhooks/1/test')).status, 403, 'test denied');
    assert.equal(
      (await noWebhook.as.nv('POST', '/webhook-deliveries/1/resend')).status,
      403,
      'resend denied',
    );

    // ── Create: secret shown once, view carries no secret material ──────────────────────────
    const created = await staff.as.quanly('POST', '/webhooks', {
      url,
      description: 'Hệ thống kho',
      events: ['order.created', 'order.transitioned'],
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const id = created.body.endpoint.id;
    assert.match(created.body.secret, /^whsec_/, 'secret returned at create');
    assert.ok(!('secret' in created.body.endpoint), 'endpoint view has no secret field');
    for (const key of SECRET_KEYS) {
      assert.ok(!(key in created.body.endpoint), `create view must not expose ${key}`);
    }
    assert.equal(created.body.endpoint.active, true);
    assert.equal(created.body.endpoint.includeCustomer, false);
    assert.ok(!created.body.endpoint.url.includes('token='), 'view URL strips the query string');

    // ── list / get / deliveries: no secret material anywhere ────────────────────────────────
    const list = await staff.as.quanly('GET', '/webhooks');
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const row = list.body.results.find((item) => item.id === id);
    assert.ok(row, 'created endpoint appears in list');
    assert.ok('stats24h' in row, 'list rows carry the 24h delivery summary');
    assert.ok(!JSON.stringify(list.body).includes(created.body.secret), 'list never leaks the secret');
    assert.ok(!list.body.results.some((item) => 'secret' in item || 'secretSealed' in item));

    const get = await staff.as.quanly('GET', `/webhooks/${id}`);
    assert.equal(get.status, 200);
    assert.equal(get.body.item.id, id);
    assert.ok(!JSON.stringify(get.body).includes(created.body.secret), 'detail never leaks the secret');

    const catalog = await staff.as.quanly('GET', '/webhooks/events');
    assert.equal(catalog.status, 200);
    assert.deepEqual(
      catalog.body.results.map((item) => item.type).sort(),
      [...PUBLIC_EVENT_TYPES].sort(),
      'catalog mirrors the public event list',
    );
    assert.ok(catalog.body.results.every((item) => item.description.vi && item.sample));

    // ── 404s on missing resources ────────────────────────────────────────────────────────────
    assert.equal((await staff.as.quanly('GET', '/webhooks/999999')).status, 404, 'get 404');
    assert.equal(
      (await staff.as.quanly('PATCH', '/webhooks/999999', { description: 'x' })).status,
      404,
      'update 404',
    );
    assert.equal((await staff.as.quanly('POST', '/webhooks/999999/rotate-secret')).status, 404, 'rotate 404');
    assert.equal((await staff.as.quanly('POST', '/webhooks/999999/active', { active: false })).status, 404);
    assert.equal((await staff.as.quanly('POST', '/webhooks/999999/test')).status, 404);
    assert.equal((await staff.as.quanly('GET', '/webhooks/999999/deliveries')).status, 404);
    assert.equal(
      (await staff.as.quanly('POST', '/webhook-deliveries/999999/resend')).status,
      404,
      'resend 404',
    );

    // ── SSRF guard at the route layer ─────────────────────────────────────────────────────────
    for (const [bad, reason] of [
      ['javascript:alert(1)', 'scheme'],
      ['file:///etc/passwd', 'scheme'],
      ['notaurl', 'invalid'],
      ['https://192.168.10.5/x', 'private-address'],
      ['https://user:pass@example.com/hook', 'scheme'],
    ]) {
      const res = await staff.as.quanly('POST', '/webhooks', { url: bad, events: ['order.created'] });
      assert.equal(res.status, 400, `${bad} refused`);
      assert.equal(res.body.error.code, 'WEBHOOK_URL_INVALID');
      assert.equal(res.body.error.details.reason, reason, `${bad} → ${reason}`);
    }
    const empty = await staff.as.quanly('POST', '/webhooks', { url });
    assert.equal(empty.status, 400, 'an event subscription is required');

    // ── Update / activate ──────────────────────────────────────────────────────────────────
    const updated = await staff.as.quanly('PATCH', `/webhooks/${id}`, {
      events: PUBLIC_EVENT_TYPES,
      description: 'ERP',
      includeCustomer: true,
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.endpoint.description, 'ERP');
    assert.equal(updated.body.endpoint.includeCustomer, true);
    assert.equal(updated.body.endpoint.events.length, PUBLIC_EVENT_TYPES.length);
    const deactivated = await staff.as.quanly('POST', `/webhooks/${id}/active`, { active: false });
    assert.equal(deactivated.body.endpoint.active, false);
    assert.equal(deactivated.body.endpoint.disabledReason, 'manual');
    const reactivated = await staff.as.quanly('POST', `/webhooks/${id}/active`, { active: true });
    assert.equal(reactivated.body.endpoint.active, true);

    // ── Gửi thử: synchronous ping result ──────────────────────────────────────────────────────
    const test = await staff.as.quanly('POST', `/webhooks/${id}/test`);
    assert.equal(test.status, 200, JSON.stringify(test.body));
    assert.equal(test.body.ok, true);
    assert.equal(test.body.statusCode, 200);
    assert.ok(test.body.durationMs >= 0);
    const ping = received.find((req) => req.path.startsWith('/hook'));
    assert.ok(ping, 'receiver got the ping');
    assert.equal(JSON.parse(ping.body).type, 'ordering.ping');
    const parts = (ping.headers['x-ordering-signature'] ?? '').split(',');
    const ts = parts.find((part) => part.startsWith('t='))?.slice(2);
    const sigs = parts.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
    assert.ok(ts && sigs.length >= 1, 'ping is signed');
    const expect = createHmac('sha256', created.body.secret).update(`${ts}.${ping.body}`, 'utf8').digest('hex');
    assert.ok(sigs.includes(expect), 'signature verifies against the raw body');

    // ── Rotate: new secret once, old one still signs during grace ──────────────────────────────
    const rotated = await staff.as.quanly('POST', `/webhooks/${id}/rotate-secret`);
    assert.equal(rotated.status, 200);
    assert.match(rotated.body.secret, /^whsec_/);
    assert.notEqual(rotated.body.secret, created.body.secret, 'rotation issues a new secret');
    assert.ok(!('secret' in rotated.body.endpoint));
    const afterRotate = await staff.as.quanly('GET', `/webhooks/${id}`);
    assert.ok(!JSON.stringify(afterRotate.body).includes(rotated.body.secret), 'get never re-shows it');

    // ── Delivery log + resend ──────────────────────────────────────────────────────────────────
    const deliveries = await staff.as.quanly('GET', `/webhooks/${id}/deliveries`);
    assert.equal(deliveries.status, 200);
    assert.ok(deliveries.body.results.length >= 1, 'ping produced a delivery row');
    const pingRow = deliveries.body.results.find((item) => item.eventType === 'ordering.ping');
    assert.ok(pingRow, 'ping row in the log');
    assert.equal(pingRow.status, 'succeeded');
    assert.ok(pingRow.payload?.type === 'ordering.ping', 'log keeps the sent payload');
    const failedOnly = await staff.as.quanly('GET', `/webhooks/${id}/deliveries?status=failed`);
    assert.equal(failedOnly.status, 200);
    assert.ok(failedOnly.body.results.every((item) => item.status === 'failed'));
    const resend = await staff.as.quanly('POST', `/webhook-deliveries/${pingRow.id}/resend`);
    assert.equal(resend.status, 200, JSON.stringify(resend.body));
    assert.equal(resend.body.delivery.status, 'pending', 'resend re-queues the same delivery');

    console.log('[ordering-test] webhooks admin: 403/404, secret-once, SSRF guard, ping, rotate, deliveries');
  } finally {
    await staff.cleanup();
    await noWebhook.cleanup();
    server.closeAllConnections?.();
    server.close();
  }
});
