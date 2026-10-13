// O8 step 7–8: order ratings. Completion stamps completedAt and schedules one invite email after
// the delay (skipped once rated); the public API rates with the order token (not completed →
// RATING_NOT_AVAILABLE, past the window → window-closed, past editableUntil → RATING_LOCKED);
// ≤ 2 stars opens `low-rating` for the branch, an edit 3 → 1 too; staff list/hide/note follow
// scope and `rating.manage`; reports carry the average. Logs never print the comment.
// Run: ORDERING_TEST_DATABASE=salanca_ordering_o8 node scripts/ordering/rating.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import { seedAdminHttpStaff, seedBranches, seedMenu, withApp } from './_harness.mjs';

const systemCtx = { actor: { kind: 'system' } };

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const plugin = app.plugin('ordering');
  const capture = plugin.service('registry').notificationProvider('email');
  const knex = app.db.connection;
  app.config.set('plugin::ordering.notifications.email.enabled', true);
  app.config.set('plugin::ordering.notifications.orderLinkTemplate', 'https://example.invalid/don-hang#t={token}');
  const dispatch = () => runOutboxDispatcher(app, { owner: `test:${process.pid}` });

  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}/api/v1/ordering`;
  const pub = async (method, token, body) => {
    const res = await fetch(`${base}/orders/rating`, {
      method,
      headers: {
        'X-Order-Token': token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  const staff = await seedAdminHttpStaff(app, {
    actions: ['order.read', 'order.process', 'payment.record-cash', 'rating.manage', 'report.read'],
    scopes: {
      quanly: { allLocations: false, locationRefs: ['Q1'] },
      q3: { allLocations: false, locationRefs: ['Q3'] },
    },
  });
  const readers = await seedAdminHttpStaff(app, {
    actions: ['order.read'],
    scopes: { xem: { allLocations: false, locationRefs: ['Q1'] } },
  });

  const place = async (email = 'guest@example.invalid', phone = '0901234567') =>
    plugin.service('order').createOrder(
      {
        idempotencyKey: randomUUID(),
        locationRef: 'Q1',
        locale: 'vi',
        lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
        receiveMethod: { kind: 'pickup', locationRef: 'Q1' },
        contact: { name: 'Khách test', phone, ...(email ? { email } : {}) },
        consent: { policyVersion: 'v1', channel: 'web-checkout' },
        origin: { kind: 'storefront' },
      },
      systemCtx,
    );
  const complete = async (orderId) => {
    for (const to of ['preparing', 'ready']) {
      const res = await staff.as.quanly('POST', `/orders/${orderId}/transition`, { to });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
    const paid = await staff.as.quanly('POST', `/orders/${orderId}/cash-handover`, { method: 'cash' });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    const row = await app.db.query('plugin::ordering.order').findOne({ where: { id: orderId } });
    assert.equal(row.status, 'completed');
    assert.ok(row.completedAt, 'completion stamps completedAt');
  };
  const lowAlerts = (orderId) =>
    knex('plugins_ordering_ops_alert').where({ dedupe_key: `low-rating:${orderId}` }).select('*');

  try {
    // ── Invite: one email after the delay, link opens the rating block ─────────────────
    const first = await place();
    const firstId = first.order.order.id;
    await complete(firstId);
    await dispatch();
    capture.sent.splice(0);
    const [invite] = await knex('plugins_ordering_outbox').where({ unique_key: `rating.invite:${firstId}` });
    assert.ok(invite, 'completion enqueues rating.invite');
    assert.ok(new Date(invite.available_at).getTime() > Date.now() + 50 * 60_000, 'sent after ~60 minutes');
    await dispatch();
    assert.equal(capture.sent.length, 0, 'not before the delay');
    await knex('plugins_ordering_outbox').where({ id: invite.id }).update({ available_at: new Date(Date.now() - 1000) });
    await dispatch();
    const invites = capture.sent.splice(0);
    assert.deepEqual(invites.map((mail) => mail.template), ['customer.rating-invite']);
    assert.ok(invites[0].text.includes(`#t=${first.publicToken}&rate=1`), 'link opens the rating block');
    await knex('plugins_ordering_outbox').where({ id: invite.id }).update({ delivered_at: null, available_at: new Date(Date.now() - 1000), attempts: 0 });
    await dispatch();
    assert.equal(capture.sent.length, 0, 'a replayed invite sends nothing');
    console.log('[ordering-test] rating invite: once, after the delay, link with &rate=1');

    // ── Public API ───────────────────────────────────────────────────────────────
    const open = await place('', '0901234568');
    const notDone = await pub('GET', open.publicToken);
    assert.equal(notDone.status, 200);
    assert.equal(notDone.body.rateable, false);
    assert.equal(notDone.body.reason, 'not-completed');
    const early = await pub('POST', open.publicToken, { stars: 5 });
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, 'RATING_NOT_AVAILABLE');
    assert.equal(early.body.error.details.reason, 'not-completed');

    const view = await pub('GET', first.publicToken);
    assert.equal(view.body.rateable, true);
    assert.equal(view.body.rating, null);
    assert.deepEqual(view.body.tags.map((tag) => tag.code), ['tasty', 'fast', 'wrong-item', 'late']);
    assert.equal(view.body.tags[0].label, 'Ngon');
    assert.equal((await pub('POST', first.publicToken, { stars: 6 })).status, 400);
    assert.equal((await pub('POST', first.publicToken, { stars: 4, tags: ['nope'] })).status, 400);
    assert.equal((await pub('POST', first.publicToken, { stars: 4, comment: 'x'.repeat(1001) })).status, 400);
    assert.equal((await pub('GET', 'not-a-token')).status, 401);

    const rated = await pub('POST', first.publicToken, { stars: 3, tags: ['tasty', 'tasty'], comment: ' Hơi nguội ' });
    assert.equal(rated.status, 200, JSON.stringify(rated.body));
    assert.equal(rated.body.rating.stars, 3);
    assert.deepEqual(rated.body.rating.tags, ['tasty']);
    assert.equal(rated.body.rating.comment, 'Hơi nguội');
    assert.equal(rated.body.rating.editable, true);
    assert.equal((await lowAlerts(firstId)).length, 0, '3 stars opens nothing');
    const edited = await pub('POST', first.publicToken, { stars: 1, tags: ['late'] });
    assert.equal(edited.status, 200);
    const [alertRow] = await lowAlerts(firstId);
    assert.ok(alertRow, 'an edit 3 → 1 opens low-rating');
    assert.equal(alertRow.location_ref, 'Q1');
    assert.equal(alertRow.aggregate_ref, `order:${firstId}`);
    await pub('POST', first.publicToken, { stars: 1, tags: ['late'] });
    assert.equal((await lowAlerts(firstId))[0].count, alertRow.count, 'same stars again does not bump');
    assert.equal(await app.db.query('plugin::ordering.order-rating').count({ where: { orderId: firstId } }), 1);

    await knex('plugins_ordering_order_rating').where({ order_id: firstId }).update({ editable_until: new Date(Date.now() - 1000) });
    const locked = await pub('POST', first.publicToken, { stars: 5 });
    assert.equal(locked.status, 409);
    assert.equal(locked.body.error.code, 'RATING_LOCKED');
    assert.equal((await pub('GET', first.publicToken)).body.rating.editable, false);
    console.log('[ordering-test] rating API: validation, 3 → 1 opens low-rating once, locked after the edit window');

    // Window closed: completed more than ratingWindowDays (7) ago, never rated.
    const late = await place('', '0901234569');
    await complete(late.order.order.id);
    await knex('plugins_ordering_order')
      .where({ id: late.order.order.id })
      .update({ completed_at: new Date(Date.now() - 8 * 24 * 3600_000) });
    const closed = await pub('POST', late.publicToken, { stars: 5 });
    assert.equal(closed.status, 409);
    assert.equal(closed.body.error.details.reason, 'window-closed');

    // Rated before the invite is due: the invite is skipped. 5 stars: no alert.
    const happy = await place('happy@example.invalid', '0901234570');
    const happyId = happy.order.order.id;
    await complete(happyId);
    assert.equal((await pub('POST', happy.publicToken, { stars: 5, tags: ['fast'] })).status, 200);
    await knex('plugins_ordering_outbox').where({ unique_key: `rating.invite:${happyId}` }).update({ available_at: new Date(Date.now() - 1000) });
    await dispatch();
    assert.equal(capture.sent.filter((mail) => mail.template === 'customer.rating-invite').length, 0);
    assert.equal((await lowAlerts(happyId)).length, 0);
    console.log('[ordering-test] rating: window closed after 7 days; rated orders get no invite; 5 stars no alert');

    // ── Staff: list, scope, hide, note ─────────────────────────────────────────────────
    const list = await staff.as.quanly('GET', '/ratings');
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.summary.count, 2);
    assert.equal(list.body.summary.average, 3);
    assert.equal(list.body.summary.distribution[1], 1);
    assert.equal(list.body.items[0].orderCode !== null, true);
    const lowOnly = await staff.as.quanly('GET', '/ratings?stars=1,2');
    assert.equal(lowOnly.body.items.length, 1);
    const q3List = await staff.as.q3('GET', '/ratings');
    assert.equal(q3List.body.items.length, 0, 'Q3 staff see no Q1 ratings');
    const ratingId = lowOnly.body.items[0].id;
    assert.equal((await staff.as.q3('GET', `/ratings/${ratingId}`)).status, 404);
    const detail = await readers.as.xem('GET', `/ratings/${ratingId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.order.code, first.order.order.code);
    assert.equal((await readers.as.xem('POST', `/ratings/${ratingId}/hide`, { hidden: true })).status, 403);
    const hidden = await staff.as.quanly('POST', `/ratings/${ratingId}/hide`, { hidden: true });
    assert.equal(hidden.status, 200);
    assert.equal(hidden.body.rating.status, 'hidden');
    const noted = await staff.as.quanly('POST', `/ratings/${ratingId}/note`, { note: 'Đã gọi xin lỗi khách' });
    assert.equal(noted.body.rating.staffNote, 'Đã gọi xin lỗi khách');
    const logs = await app.db
      .query('plugin::ordering.admin-change-log')
      .findMany({ where: { action: { $in: ['rating.hide', 'rating.note'] } } });
    assert.deepEqual(logs.map((row) => row.action).sort(), ['rating.hide', 'rating.note']);
    assert.ok(!JSON.stringify(logs).includes('xin lỗi'), 'the note text stays out of the change log');
    const orderDetail = await staff.as.quanly('GET', `/orders/${firstId}`);
    assert.equal(orderDetail.body.rating.stars, 1, 'S4 shows the rating');
    const today = await plugin.service('admin-orders').todayFor('Q1');
    const report = await staff.as.quanly('GET', `/reports/sales?branch=Q1&from=${today}&to=${today}`);
    assert.equal(report.body.ratings.count, 1, 'the hidden 1★ rating leaves the report average');
    assert.equal(report.body.ratings.average, 5);
    const afterHide = await staff.as.quanly('GET', '/ratings');
    assert.equal(afterHide.body.items.length, 2, 'hidden ratings stay listed');
    assert.equal(afterHide.body.summary.count, 1);
    assert.equal(afterHide.body.summary.average, 5);
    console.log('[ordering-test] rating staff: scope 404, hide needs rating.manage, note not logged, hidden ratings out of the average');
  } finally {
    await staff.cleanup();
    await readers.cleanup();
  }
});
