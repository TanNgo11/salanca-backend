// R1b: the read-only "Lịch sử gửi" API — scope, filters, reason labels, pagination, the
// second-permission technical tail, and the missing-branch-email warning.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import { seedAdminHttpStaff, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const HASH = 'a'.repeat(64);
const bulkRow = (i) => ({
  event_id: `bulk:${i}`,
  template: 'staff.order-created',
  channel: 'email',
  recipient_hash: i.toString(16).padStart(64, '0'),
  recipient_role: 'staff',
  order_id: null,
  message_locale: 'vi',
  status: 'sent',
  attempts: 1,
  sent_at: new Date(),
  created_at: new Date(),
  updated_at: new Date(),
});

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  await app.listen();
  const { order } = services(app);
  const plugin = app.plugin('ordering');
  const capture = plugin.service('registry').notificationProvider('email');
  const knex = app.db.connection;

  const schedule = (overrides = {}) =>
    JSON.stringify({
      pickup: {
        enabled: true,
        paymentTiming: 'pay-on-pickup',
        paymentProviders: ['cash'],
        schedule: { leadTimeMinutes: 30, openingHours: { mode: '24_7' } },
      },
      ...overrides,
    });
  // Q1 gets an email (not "missing"); Q3 stays without one (the warning banner fixture).
  await knex('plugins_ordering_branch').where({ code: 'Q1' }).update({ email: 'q1-staff@example.invalid', fulfillment: schedule() });
  await knex('plugins_ordering_branch').where({ code: 'Q3' }).update({ fulfillment: schedule() });

  const full = await seedAdminHttpStaff(app, { scopes: { chuoi: { allLocations: true, locationRefs: [] } } });
  const readers = await seedAdminHttpStaff(app, {
    actions: ['order.read', 'notification-log.read'],
    scopes: {
      quanlyq1: { allLocations: false, locationRefs: ['Q1'] },
      nvq3: { allLocations: false, locationRefs: ['Q3'] },
    },
  });
  const scopedDetails = await seedAdminHttpStaff(app, {
    actions: ['order.read', 'notification-log.read', 'notification-log.details'],
    scopes: { q1details: { allLocations: false, locationRefs: ['Q1'] } },
  });
  const denied = await seedAdminHttpStaff(app, {
    actions: ['order.read'],
    scopes: { khongquyen: { allLocations: true, locationRefs: [] } },
  });

  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const range = `from=${today}&to=${today}`;
  const dispatch = () => runOutboxDispatcher(app, { owner: `nlog:${process.pid}` });
  const place = (overrides) =>
    order.createOrder(
      {
        idempotencyKey: randomUUID(),
        locationRef: 'Q1',
        locale: 'en',
        lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
        receiveMethod: { kind: 'pickup', locationRef: 'Q1' },
        pickup: { asap: true },
        consent: { policyVersion: 'v1', channel: 'web-checkout' },
        origin: { kind: 'storefront' },
        ...overrides,
      },
      systemCtx,
    );

  try {
    // ── 1. A delivered Q1 order: rows, labels, and no leaked technical columns ──────────────
    const first = await place({ contact: { name: 'Khách A', phone: '0901234567', email: 'guest@example.invalid' } });
    await dispatch();
    const list = await full.as.chuoi('GET', `/notification-log?${range}`);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.range.timezone, 'Asia/Ho_Chi_Minh');
    const customerRow = list.body.rows.find(
      (row) => row.template === 'customer.order-placed' && row.orderId === first.order.order.id,
    );
    assert.ok(customerRow, 'customer.order-placed row present');
    assert.equal(customerRow.status, 'sent');
    assert.equal(customerRow.channel, 'email');
    assert.equal(customerRow.orderCode, first.order.order.code);
    assert.equal(customerRow.reasonCode, null);
    assert.ok(customerRow.templateLabel.length > 0);
    for (const key of ['recipientHash', 'eventId', 'lastError', 'providerMessageId', 'costEstimate']) {
      assert.ok(!(key in customerRow), `list row must not expose ${key}`);
    }
    console.log('[ordering-test] nlog: list shape, labels, no leaked columns');

    // ── 2. Scope: Q1 / Q3 / branch-less rows ────────────────────────────────────────────────
    const q3 = await order.createOrder(
      {
        idempotencyKey: randomUUID(),
        locationRef: 'Q3',
        locale: 'en',
        lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
        receiveMethod: { kind: 'pickup', locationRef: 'Q3' },
        pickup: { asap: true },
        contact: { name: 'Khách Q3', phone: '0901234567', email: 'q3@example.invalid' },
        consent: { policyVersion: 'v1', channel: 'web-checkout' },
        origin: { kind: 'storefront' },
      },
      systemCtx,
    );
    await dispatch();
    await knex('plugins_ordering_notification_delivery').insert({
      event_id: 'test:order-less',
      template: 'staff.ops-alert',
      channel: 'email',
      recipient_hash: HASH,
      recipient_role: 'staff',
      order_id: null,
      message_locale: 'vi',
      status: 'sent',
      attempts: 1,
      sent_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    });
    const q1List = await readers.as.quanlyq1('GET', `/notification-log?${range}`);
    assert.ok(q1List.body.rows.every((row) => row.orderId !== null), 'scoped staff never see branch-less rows');
    assert.ok(q1List.body.rows.some((row) => row.orderId === first.order.order.id));
    assert.ok(!q1List.body.rows.some((row) => row.orderId === q3.order.order.id));
    const q3List = await readers.as.nvq3('GET', `/notification-log?${range}`);
    assert.ok(q3List.body.rows.some((row) => row.orderId === q3.order.order.id));
    assert.ok(!q3List.body.rows.some((row) => row.orderId === first.order.order.id));
    const allList = await full.as.chuoi('GET', `/notification-log?${range}`);
    assert.ok(allList.body.rows.some((row) => row.orderId === null), 'allLocations sees branch-less rows');

    // ── 3. Failed delivery: the technical tail is a second-permission route ──────────────────
    const failOrder = await place({ contact: { name: 'Khách B', phone: '0901234567', email: 'fail@example.invalid' } });
    await dispatch();
    capture.sent.splice(0);
    capture.failNext = 1;
    const reject = await full.as.chuoi('POST', `/orders/${failOrder.order.order.id}/transition`, {
      to: 'rejected',
      reasonCode: 'out-of-stock',
    });
    assert.equal(reject.status, 200, JSON.stringify(reject.body));
    await dispatch();
    const failedList = await full.as.chuoi('GET', `/notification-log?${range}&status=failed`);
    assert.ok(failedList.body.rows.length >= 1, 'a failed row exists');
    const failedRow = failedList.body.rows[0];
    assert.ok(!('lastError' in failedRow), 'failed rows in the list hide lastError');
    const technical = await full.as.chuoi('GET', `/notification-log/${failedRow.id}/technical`);
    assert.equal(technical.status, 200);
    assert.ok(typeof technical.body.lastError === 'string' && technical.body.lastError.length > 0);
    assert.equal(
      (await readers.as.quanlyq1('GET', `/notification-log/${failedRow.id}/technical`)).status,
      403,
      'technical needs notification-log.details',
    );
    const plainDetail = await readers.as.quanlyq1('GET', `/notification-log/${failedRow.id}`);
    assert.equal(plainDetail.status, 200);
    assert.ok(!('lastError' in plainDetail.body), 'plain detail hides lastError');

    // ── 4. Skipped reason codes carry a label ────────────────────────────────────────────────
    app.config.set('plugin::ordering.notifications.email.enabled', false);
    const skipOrder = await place({ contact: { name: 'Khách C', phone: '0901234567', email: 'skip@example.invalid' } });
    await dispatch();
    app.config.set('plugin::ordering.notifications.email.enabled', true);
    const skipList = await full.as.chuoi('GET', `/notification-log?${range}&status=skipped`);
    const skipRow = skipList.body.rows.find((row) => row.orderId === skipOrder.order.order.id);
    assert.equal(skipRow.reasonCode, 'email-disabled');
    assert.ok(skipRow.reasonLabel && skipRow.reasonLabel.length > 0, 'skipped row carries a reason label');

    // ── 5. Missing permission → 403 on every route ───────────────────────────────────────────
    for (const path of [
      '/notification-log',
      '/notification-log/summary',
      `/notification-log/${failedRow.id}`,
      `/notification-log/${failedRow.id}/technical`,
    ]) {
      assert.equal((await denied.as.khongquyen('GET', path)).status, 403, path);
    }

    // ── 6. Validation ────────────────────────────────────────────────────────────────────────
    const badRange = `from=2026-01-01&to=2026-12-31`;
    for (const [path, field] of [
      ['/notification-log?from=2026-13-40', 'from'],
      [`/notification-log?${badRange}`, 'to'],
      ['/notification-log?status=bogus', 'status'],
      ['/notification-log?channel=bogus', 'channel'],
      ['/notification-log?template=bogus', 'template'],
      ['/notification-log?role=bogus', 'role'],
      ['/notification-log?page=0', 'page'],
    ]) {
      const res = await full.as.chuoi('GET', path);
      assert.equal(res.status, 400, path);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR', path);
      assert.equal(res.body.error.details.field, field, path);
    }

    // ── 7. `q` filters by order code; an unknown code is an empty list, not an error ─────────
    const byCode = await full.as.chuoi('GET', `/notification-log?${range}&q=${first.order.order.code.toLowerCase()}`);
    assert.ok(byCode.body.rows.length >= 1 && byCode.body.rows.every((row) => row.orderId === first.order.order.id));
    const noCode = await full.as.chuoi('GET', `/notification-log?${range}&q=zzz-nope`);
    assert.equal(noCode.status, 200);
    assert.deepEqual(noCode.body.rows, []);

    // ── 9. Summary ───────────────────────────────────────────────────────────────────────────
    const summary = await full.as.chuoi('GET', '/notification-log/summary');
    assert.equal(summary.status, 200);
    assert.equal(summary.body.timezone, 'Asia/Ho_Chi_Minh');
    assert.equal(summary.body.paid.dailyLimit, 2000);
    assert.equal(summary.body.mode, 'live');
    assert.ok(summary.body.last24h.sent >= 1);
    assert.ok(summary.body.last24h.failed >= 1);
    assert.ok(summary.body.branchesWithoutEmail.some((branch) => branch.code === 'Q3'), 'Q3 has no email');
    assert.ok(!summary.body.branchesWithoutEmail.some((branch) => branch.code === 'Q1'), 'Q1 has an email');
    const summaryQ1 = await readers.as.quanlyq1('GET', '/notification-log/summary');
    assert.deepEqual(summaryQ1.body.branchesWithoutEmail, [], 'Q3 is out of a Q1 scope');

    // ── 10. `/summary` is not swallowed by `/:id` ────────────────────────────────────────────
    assert.equal((await full.as.chuoi('GET', '/notification-log/summary')).status, 200);

    // ── 11. Out-of-scope detail/technical → 404 (no existence leak) ──────────────────────────
    const q3Row = allList.body.rows.find((row) => row.orderId === q3.order.order.id);
    assert.equal((await scopedDetails.as.q1details('GET', `/notification-log/${q3Row.id}`)).status, 404);
    assert.equal((await scopedDetails.as.q1details('GET', `/notification-log/${q3Row.id}/technical`)).status, 404);

    // ── 12. Channel / template / role filters ────────────────────────────────────────────────
    assert.ok((await full.as.chuoi('GET', `/notification-log?${range}&channel=email`)).body.rows.every((row) => row.channel === 'email'));
    assert.ok(
      (await full.as.chuoi('GET', `/notification-log?${range}&template=customer.order-placed`)).body.rows.every(
        (row) => row.template === 'customer.order-placed',
      ),
    );
    assert.ok((await full.as.chuoi('GET', `/notification-log?${range}&role=customer`)).body.rows.every((row) => row.recipientRole === 'customer'));

    // ── 8. Pagination (last: it owns the table state) ────────────────────────────────────────
    await knex('plugins_ordering_notification_delivery').del();
    await knex('plugins_ordering_notification_delivery').insert(Array.from({ length: 55 }, (_, i) => bulkRow(i)));
    const page1 = await full.as.chuoi('GET', `/notification-log?${range}&page=1`);
    assert.equal(page1.body.rows.length, 50);
    assert.equal(page1.body.hasNext, true);
    assert.ok(page1.body.rows[0].id > page1.body.rows[49].id, 'rows descend by id');
    const page2 = await full.as.chuoi('GET', `/notification-log?${range}&page=2`);
    assert.equal(page2.body.rows.length, 5);
    assert.equal(page2.body.hasNext, false);

    // ── 13. A malformed or out-of-range id is a clean 404, never a Postgres 500 ─────────────
    // `1.5` must not resolve to row 1, and a value past the `integer` column must not reach the
    // driver (22P02 / 22003 leak a database error into the log and answer 500).
    for (const id of ['abc', '1.5', '0', '-1', '99999999999999999999', '2147483648', '2147483647']) {
      for (const path of [`/notification-log/${id}`, `/notification-log/${id}/technical`]) {
        const res = await full.as.chuoi('GET', path);
        assert.equal(res.status, 404, `${path} -> ${res.status}`);
        assert.equal(res.body.error.code, 'NOTIFICATION_DELIVERY_NOT_FOUND', path);
      }
    }

    console.log('[ordering-test] notification-log: scope, filters, reasons, technical gate, pagination, summary');
  } finally {
    await full.cleanup();
    await readers.cleanup();
    await scopedDetails.cleanup();
    await denied.cleanup();
  }
});
