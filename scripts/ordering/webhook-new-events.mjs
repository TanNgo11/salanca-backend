import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';

import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import { runWebhookDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/webhook-dispatcher.js';
import { basicOrderInput, seedAdminHttpStaff, seedBranches, seedMenu, systemCtx, withApp } from './_harness.mjs';

// Core gaps step 5: the `promotion.redeemed` and `rating.created` public events. A reserved
// promotion emits once per promotion in the order's own transaction; the first rating emits once
// and never carries the free-text comment; an edit does not emit again.
withApp(async (app) => {
  app.config.set('plugin::ordering.webhooks.allowHttp', true);
  app.config.set('plugin::ordering.webhooks.allowHosts', ['127.0.0.1']);

  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.end('{}');
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  await seedBranches(app);
  seedMenu(app);
  const plugin = app.plugin('ordering');
  const outboxRows = (type) => app.db.query('plugin::ordering.outbox').findMany({ where: { type } });
  const dispatch = () => runOutboxDispatcher(app, { owner: `test:${process.pid}` });
  const send = () => runWebhookDispatcher(app, { owner: `test:${process.pid}` });

  await app.listen();
  const staff = await seedAdminHttpStaff(app, {
    actions: ['order.read', 'order.process', 'payment.record-cash'],
    scopes: { quanly: { allLocations: false, locationRefs: ['Q1'] } },
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/hook`;
    await plugin
      .service('webhook-endpoint')
      .create({ url, events: ['promotion.redeemed', 'rating.created'] }, systemCtx);

    const promo = await app.db.query('plugin::ordering.promotion').create({
      data: {
        name: { vi: 'Giảm 10%', en: '10% off' },
        kind: 'code',
        discountType: 'percent',
        value: 10,
        maxDiscount: null,
        target: { kind: 'order', refs: [] },
        minSubtotal: 0,
        locationRefs: ['Q1'],
        receiveKinds: ['pickup'],
        startsAt: '2026-10-01T00:00:00.000Z',
        endsAt: '2026-12-01T00:00:00.000Z',
        weekdays: [],
        timeRanges: [],
        firstOrderOnly: false,
        usageLimit: null,
        perCustomerLimit: null,
        stackable: false,
        priority: 1,
        active: true,
        usedCount: 0,
      },
    });
    await app.db
      .query('plugin::ordering.promotion-code')
      .create({ data: { promotionId: promo.id, code: 'GIAM10', usageLimit: null, usedCount: 0, active: true } });

    // ── promotion.redeemed ───────────────────────────────────────────────────────────────
    const plain = await plugin
      .service('order')
      .createOrder(basicOrderInput({ adjustments: [], placedAt: '2026-10-13T04:30:00.000Z' }), systemCtx);
    assert.equal((await outboxRows('promotion.redeemed')).length, 0, 'no promotion, no event');

    const withCode = await plugin.service('order').createOrder(
      basicOrderInput({
        adjustments: [],
        promotionCode: 'giam10',
        contact: { name: 'Khách mã', phone: '+84901110002' },
        placedAt: '2026-10-13T04:30:00.000Z',
      }),
      systemCtx,
    );
    const orderId = withCode.order.order.id;
    const events = await outboxRows('promotion.redeemed');
    assert.equal(events.length, 1, 'one event for the reserved promotion');
    assert.equal(events[0].uniqueKey, `promotion.redeemed:${orderId}:${promo.id}`);

    await dispatch();
    await send();
    const redeemed = received.filter((body) => body.type === 'promotion.redeemed');
    assert.equal(redeemed.length, 1);
    assert.deepEqual(Object.keys(redeemed[0].data).sort(), [
      'code',
      'discountAmount',
      'locationRef',
      'orderCode',
      'orderId',
      'promotionId',
    ]);
    assert.equal(redeemed[0].data.orderId, orderId);
    assert.equal(redeemed[0].data.orderCode, withCode.order.order.code);
    assert.equal(redeemed[0].data.promotionId, promo.id);
    assert.equal(redeemed[0].data.code, 'GIAM10');
    assert.equal(redeemed[0].data.discountAmount, 22000, '10% of 220.000');
    assert.equal(redeemed[0].data.locationRef, 'Q1');
    assert.ok(!JSON.stringify(redeemed[0]).includes('0901110002'), 'no phone in the event');

    // ── rating.created ───────────────────────────────────────────────────────────────────
    const orderIdPlain = plain.order.order.id;
    for (const to of ['preparing', 'ready']) {
      assert.equal((await staff.as.quanly('POST', `/orders/${orderIdPlain}/transition`, { to })).status, 200);
    }
    assert.equal(
      (await staff.as.quanly('POST', `/orders/${orderIdPlain}/cash-handover`, { method: 'cash' })).status,
      200,
    );
    const base = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
    const rate = async (body) => {
      const res = await fetch(`${base}/orders/rating`, {
        method: 'POST',
        headers: { 'X-Order-Token': plain.publicToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    };
    const first = await rate({ stars: 4, tags: ['tasty'], comment: 'Ngon, gọi 0901234567 nhé' });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const edited = await rate({ stars: 5, tags: ['tasty', 'fast'], comment: 'Đã sửa' });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));

    const created = await outboxRows('rating.created');
    assert.equal(created.length, 1, 'the edit emits nothing');
    assert.equal(created[0].uniqueKey, `rating.created:${orderIdPlain}`);
    await dispatch();
    await send();
    const rated = received.filter((body) => body.type === 'rating.created');
    assert.equal(rated.length, 1);
    assert.deepEqual(Object.keys(rated[0].data).sort(), [
      'locationRef',
      'orderCode',
      'orderId',
      'ratingId',
      'stars',
      'tags',
    ]);
    assert.equal(rated[0].data.stars, 4, 'the first rating is what was announced');
    assert.deepEqual(rated[0].data.tags, ['tasty']);
    assert.equal(rated[0].data.orderCode, plain.order.order.code);
    const raw = JSON.stringify(rated[0]);
    assert.ok(!raw.includes('0901234567') && !raw.includes('comment') && !raw.includes('Ngon'), 'no comment text');
    const stored = JSON.stringify(created[0].payload);
    assert.ok(!stored.includes('comment') && !stored.includes('0901234567'), 'not even in the outbox row');
    void randomUUID;
  } finally {
    await staff.cleanup();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('[ordering-test] webhook-new-events: promotion.redeemed once per promotion, rating.created without comment and not on edit verified');
});
