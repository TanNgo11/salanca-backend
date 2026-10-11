import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { seedAdminHttpStaff, seedBranches, seedMenu, systemCtx, withApp } from './_harness.mjs';

// O3 step 8: the admin SSE stream delivers order events within seconds, only for branches in the
// viewer's scope, and never for a transaction that rolled back.
withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  await app.listen();
  const http = await seedAdminHttpStaff(app, {
    actions: ['order.read'],
    scopes: { lan: { allLocations: false, locationRefs: ['Q1'] }, chain: { allLocations: true, locationRefs: [] } },
  });
  const base = `http://127.0.0.1:${process.env.PORT}`;

  const open = async (name) => {
    const controller = new AbortController();
    const token = await http.tokenOf(name);
    const res = await fetch(`${base}/ordering/orders/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const events = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index;
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            const data = /^data: (.*)$/m.exec(frame)?.[1];
            if (data) events.push(JSON.parse(data));
          }
        }
      } catch {
        // aborted
      }
    })();
    return { events, close: () => controller.abort() };
  };

  const waitFor = async (predicate, ms = 3000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return predicate();
  };

  const place = (locationRef) =>
    app.plugin('ordering').service('order').createOrder(
      {
        idempotencyKey: randomUUID(),
        locationRef,
        lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
        receiveMethod: { kind: 'pickup', locationRef },
        contact: { phone: '0901234567' },
        consent: { policyVersion: 'v1', channel: 'web-checkout' },
        origin: { kind: 'storefront' },
      },
      systemCtx,
    );

  const lan = await open('lan');
  const chain = await open('chain');
  try {
    const q1 = await place('Q1');
    assert.ok(
      await waitFor(() => lan.events.some((event) => event.type === 'order.created' && event.orderId === q1.order.order.id)),
      'Q1 staff hears the Q1 order within seconds',
    );
    const q3 = await place('Q3');
    assert.ok(await waitFor(() => chain.events.some((event) => event.orderId === q3.order.order.id)));
    assert.ok(!lan.events.some((event) => event.orderId === q3.order.order.id), 'Q3 never reaches Q1 staff');

    const before = lan.events.length;
    await assert.rejects(
      app.db.transaction(async () => {
        await place('Q1');
        throw new Error('rolled back on purpose');
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(lan.events.length, before, 'a rolled-back order publishes nothing');

    await app.plugin('ordering').service('transition').transitionGroup(
      { orderId: q1.order.order.id, groupId: q1.order.groups[0].id, to: 'preparing' },
      systemCtx,
    );
    assert.ok(
      await waitFor(() => lan.events.some((event) => event.type === 'order.updated' && event.to === 'preparing')),
      'transitions are streamed',
    );
    for (const event of lan.events) {
      assert.deepEqual(Object.keys(event).sort().filter((key) => !['code', 'to'].includes(key)), ['locationRef', 'orderId', 'type']);
    }
    console.log('[ordering-test] stream: scoped SSE, after-commit only, transitions verified');
  } finally {
    lan.close();
    chain.close();
    await http.cleanup();
  }
});
