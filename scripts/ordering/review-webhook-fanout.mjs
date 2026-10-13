import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { basicOrderInput, seedBranches, seedMenu, systemCtx } from './_harness.mjs';
import { directRun, interceptQuery } from './_review-race.mjs';

export async function testWebhookFanout(app) {
  app.cron.stop();
  app.config.set('plugin::ordering.webhooks.allowHttp', true);
  app.config.set('plugin::ordering.webhooks.allowHosts', ['127.0.0.1']);
  if (!(await app.db.query('plugin::ordering.branch').findOne({ where: { code: 'Q1' } }))) await seedBranches(app);
  seedMenu(app);
  await app.plugin('ordering').service('order').createOrder(basicOrderInput(), systemCtx);
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => { received.push(JSON.parse(Buffer.concat(chunks).toString())); res.end('{}'); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const p = app.plugin('ordering');
    const { endpoint } = await p.service('webhook-endpoint').create({
      url: `http://127.0.0.1:${server.address().port}/hook`, events: ['order.created'], includeCustomer: true,
    }, systemCtx);
    const service = p.service('webhook-delivery');
    const events = app.db.query('plugin::ordering.outbox');
    const stored = await events.findOne({ where: { type: 'order.created' }, orderBy: { id: 'desc' } });
    assert.ok(stored, 'erasure fixture supplied a real outbox event');
    const event = { ...stored, id: randomUUID(), occurredAt: new Date().toISOString() };
    const restore = interceptQuery(app, 'plugin::ordering.order', 'findOne', async () => { throw new Error('fanout-read-fixture'); });
    try { await assert.rejects(service.fanout(event), /fanout-read-fixture/); }
    finally { restore(); }
    await service.fanout(event);
    const result = await service.dispatch({ owner: 'review-fanout', now: new Date() });
    assert.equal(result.delivered, 1, 'retry must activate and deliver the complete payload');
    assert.equal(received.length, 1);
    assert.equal(received[0].type, 'order.created');
    assert.equal(received[0].data.orderId, event.payload.orderId);
    await service.fanout(event);
    await service.dispatch({ owner: 'review-fanout', now: new Date() });
    assert.equal(received.length, 1, 'replay never resets a delivered row');

    // Simulate a placeholder left by the old implementation, not just a new failure.
    const legacy = { ...event, id: randomUUID() };
    await app.db.connection('plugins_ordering_webhook_delivery').insert({
      endpoint_id: endpoint.id, event_id: String(legacy.id), event_type: legacy.type,
      payload: JSON.stringify({}), status: 'pending', attempts: 0, next_attempt_at: null,
      document_id: randomUUID().replaceAll('-', '').slice(0, 24), created_at: new Date(), updated_at: new Date(),
    });
    await Promise.all([service.fanout(legacy), service.fanout(legacy), service.fanout(legacy)]);
    const legacyRows = await app.db.query('plugin::ordering.webhook-delivery').findMany({ where: { eventId: String(legacy.id) } });
    assert.equal(legacyRows.length, 1);
    assert.ok(legacyRows[0].nextAttemptAt);
    assert.equal(legacyRows[0].payload.data.orderId, event.payload.orderId);
    assert.equal((await service.dispatch({ owner: 'review-fanout', now: new Date() })).delivered, 1);
    assert.equal(received.length, 2, 'each endpoint/event has one successful delivery');
    await app.db.query('plugin::ordering.webhook-endpoint').update({ where: { id: endpoint.id }, data: { active: false } });
    console.log('[review-race] webhook: retry delivers once; legacy placeholder repaired under concurrent fanout');
  } finally { await new Promise(resolve => server.close(resolve)); }
}
await directRun(import.meta.url, testWebhookFanout);
