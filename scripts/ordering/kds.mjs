import assert from 'node:assert/strict';

// O12 step 6 (screens N2): HTTP-level check of the kitchen display —
// GET /ordering/kitchen?branch=&station= lists in-flight groups with resolved stations,
// POST .../orders/:id/start stamps kitchenStartedAt (KDS-only state),
// POST .../lines/:lineId/prepared toggles per-line done, POST .../orders/:id/complete runs the
// workflow `ready` transition, and every route is scoped + kitchen.read-gated.
import {
  basicOrderInput,
  seedAdminHttpStaff,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

withApp(async (app) => {
  const { order } = services(app);
  await seedBranches(app);
  seedMenu(app);
  const branchRows = app.db.query('plugin::ordering.branch');
  const q1 = await branchRows.findOne({ where: { code: 'Q1' } });
  await branchRows.update({
    where: { id: q1.id },
    data: {
      fulfillment: {
        pickup: {
          enabled: true,
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          schedule: { openingHours: { mode: '24_7' } },
        },
      },
    },
  });

  // The test catalog keeps whatever `metadata` a sellable is seeded with — put bun-bo on
  // the hot-station so station resolution + filtering are exercised end-to-end.
  const catalog = app.plugin('ordering').service('registry').catalogAdapter('test-catalog');
  const bunBo = await catalog.getSellable({}, { uid: 'bun-bo' });
  catalog.seed([{ ...bunBo, metadata: { catalog: { kitchenStation: 'Bếp nóng' } } }]);

  const created = await order.createOrder(
    basicOrderInput({ customerNote: 'ít đường' }),
    systemCtx,
  );
  const orderId = created.order.order.id;
  const orderCode = created.order.order.code;
  const groups = app.db.query('plugin::ordering.fulfillment-group');
  const group = await groups.findOne({ where: { order: orderId } });

  await app.listen();
  const http = await seedAdminHttpStaff(app, {
    actions: ['kitchen.read'],
    scopes: {
      lan: { allLocations: false, locationRefs: ['Q1'] },
      other: { allLocations: false, locationRefs: ['Q3'] },
    },
  });
  const noKitchen = await seedAdminHttpStaff(app, {
    actions: ['order.read'],
    scopes: { reader: { allLocations: true, locationRefs: [] } },
  });
  try {
    const { lan, other } = http.as;

    // ── Board: the new order shows under Q1 with resolved stations ─────────────────
    const board = await lan('GET', '/kitchen?branch=Q1');
    assert.equal(board.status, 200, JSON.stringify(board.body));
    const card = board.body.item.orders.find((row) => row.orderId === orderId);
    assert.ok(card, 'order is on the Q1 board');
    assert.equal(card.code, orderCode);
    assert.equal(card.receiveKind, 'pickup');
    assert.equal(card.kitchenStartedAt, null);
    assert.equal(card.customerNote, 'ít đường');
    assert.equal(card.lines.find((line) => line.title === 'Bún bò')?.station, 'Bếp nóng');
    assert.equal(card.lines.length, 3);
    assert.equal(board.body.item.branch, 'Q1');
    assert.ok(board.body.item.slaMinutes > 0);

    // ── Station filter: only hot-station lines survive ─────────────────────────────
    const filtered = await lan('GET', `/kitchen?branch=Q1&station=${encodeURIComponent('Bếp nóng')}`);
    assert.equal(filtered.status, 200);
    const filteredCard = filtered.body.item.orders.find((row) => row.orderId === orderId);
    assert.ok(filteredCard, 'order still shows when it has a matching line');
    assert.deepEqual(
      filteredCard.lines.map((line) => line.title),
      ['Bún bò'],
      'station filter keeps only hot-station lines',
    );

    // ── Bắt đầu: kitchenStartedAt stamps once, idempotent ──────────────────────────
    const started = await lan('POST', `/kitchen/orders/${orderId}/start`, {});
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const firstStart = started.body.item.kitchenStartedAt;
    assert.ok(firstStart);
    const again = await lan('POST', `/kitchen/orders/${orderId}/start`, {});
    assert.equal(again.body.item.kitchenStartedAt, firstStart, 'second start keeps the stamp');

    // ── Per-line prepared toggles ──────────────────────────────────────────────────
    const lineId = card.lines.find((line) => line.title === 'Bún bò').id;
    const prepared = await lan('POST', `/kitchen/lines/${lineId}/prepared`, { prepared: true });
    assert.equal(prepared.status, 200);
    assert.ok(prepared.body.item.preparedAt);
    const unprepared = await lan('POST', `/kitchen/lines/${lineId}/prepared`, { prepared: false });
    assert.equal(unprepared.body.item.preparedAt, null);
    const bad = await lan('POST', `/kitchen/lines/${lineId}/prepared`, { prepared: 'yes' });
    assert.equal(bad.status, 400, 'non-boolean prepared is rejected');
    assert.equal((await lan('POST', '/kitchen/lines/999999/prepared', { prepared: true })).status, 404);

    // ── Xong cả đơn: `ready` flows through the workflow — needs `preparing` first ──
    const transition = app.plugin('ordering').service('transition');
    await transition.transitionGroup(
      { orderId, groupId: group.id, to: 'preparing', reason: 'accepted' },
      systemCtx,
    );
    const done = await lan('POST', `/kitchen/orders/${orderId}/complete`, {});
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const moved = await groups.findOne({ where: { id: group.id } });
    assert.equal(moved.status, 'ready');
    const doneBoard = await lan('GET', '/kitchen?branch=Q1');
    const doneCard = doneBoard.body.item.orders.find((row) => row.orderId === orderId);
    assert.equal(doneCard.status, 'ready');
    assert.ok(doneCard.finishedAt, 'done card carries its finish time');

    // ── Completion of an already-ready order is a conflict, not a silent no-op ──────
    assert.equal((await lan('POST', `/kitchen/orders/${orderId}/complete`, {})).status, 409);
    assert.equal((await lan('POST', '/kitchen/orders/999999/complete', {})).status, 404);

    // ── Scope + permission gates ───────────────────────────────────────────────────
    assert.equal(
      (await other('GET', '/kitchen?branch=Q1')).status,
      404,
      'out-of-scope branches answer 404',
    );
    assert.equal((await other('POST', `/kitchen/orders/${orderId}/start`, {})).status, 404);
    assert.equal(
      (await noKitchen.as.reader('GET', '/kitchen?branch=Q1')).status,
      403,
      'kitchen.read is required',
    );

    console.log(
      '[ordering-test] kds: board + station filter, start/prepared/complete, scope + permission verified',
    );
  } finally {
    await http.cleanup();
    await noKitchen.cleanup();
  }
});
