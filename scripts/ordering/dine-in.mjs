import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Trusted visitor-IP forwarding for the storefront calls.
process.env.FORM_INTAKE_SHARED_SECRET = 'storefront-test-secret';

import { runTableSessionAutoclose } from '../../src/plugins/ordering/dist/server/src/jobs/table-session-autoclose.js';
import {
  seedAdminHttpStaff,
  seedBranches,
  seedMenu,
  services,
  systemCtx,
  withApp,
} from './_harness.mjs';

// O12 step 7 (screens N6–N7): QR table ordering — admin table CRUD + bulk create + QR
// rotation, the public token resolve, dine-in order create on the table token (secret never
// persisted), first-order table sessions shared across orders incl. a concurrent pair, the
// N7 session board, "Thanh toán & đóng bàn" cash collection with the closer's actorRef,
// unfinished-order blocking, idempotent re-close, and the alert-only autoclose job.
withApp(async (app) => {
  const { order, transition } = services(app);
  await seedBranches(app);
  seedMenu(app);
  const branchRows = app.db.query('plugin::ordering.branch');
  const q1 = await branchRows.findOne({ where: { code: 'Q1' } });
  const q3 = await branchRows.findOne({ where: { code: 'Q3' } });
  const dineInOpen = {
    enabled: true,
    paymentTiming: 'pay-on-pickup',
    paymentProviders: ['cash'],
    schedule: { openingHours: { mode: '24_7' } },
  };
  await branchRows.update({
    where: { id: q1.id },
    data: { fulfillment: { dineIn: dineInOpen } },
  });
  // Q3 takes dine-in too — a Q1 table token must still not order there (hash + branch scope).
  await branchRows.update({
    where: { id: q3.id },
    data: { fulfillment: { dineIn: dineInOpen } },
  });
  await app.listen();
  const base = `http://127.0.0.1:${process.env.PORT}`;
  let visitor = 1;
  const api = async (method, path, body, headers = {}) => {
    const res = await fetch(`${base}/api/v1/ordering${path}`, {
      method,
      headers: {
        'x-salanca-intake-secret': 'storefront-test-secret',
        'x-salanca-visitor-ip': `192.0.3.${visitor++}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const http = await seedAdminHttpStaff(app, {
    actions: ['table.manage', 'order.read', 'order.process', 'payment.record-cash'],
    scopes: {
      lan: { allLocations: false, locationRefs: ['Q1'] },
      other: { allLocations: false, locationRefs: ['Q3'] },
    },
  });
  const noTables = await seedAdminHttpStaff(app, {
    actions: ['order.read'],
    scopes: { reader: { allLocations: true, locationRefs: [] } },
  });
  const sessions = () => app.db.query('plugin::ordering.table-session');
  const tables = () => app.db.query('plugin::ordering.dining-table');
  const tokenOf = (qrUrl) => qrUrl.match(/[?&]t=([^&]+)/)[1];
  const orderBody = (tableToken, branch = 'Q1') => ({
    branch,
    lines: [{ sellableUid: 'bun-bo', quantity: 1 }],
    receiveMethod: { kind: 'dine-in', locationRef: branch, tableToken },
    contact: { name: 'Khách bàn', phone: '+84900000001' },
    consent: { policyVersion: 'v1', accepted: true },
    captchaToken: 'pass',
  });
  const key = () => ({ 'Idempotency-Key': `test-${randomUUID()}` });
  const place = (tableToken, branch) => api('POST', '/orders', orderBody(tableToken, branch), key());

  try {
    const { lan, other } = http.as;

    // ── N6 table management: single, bulk, duplicate-code, scope, permission ────────────
    const created = await lan('POST', '/tables', {
      locationRef: 'Q1',
      code: 'b1',
      name: 'Bàn 1',
      area: 'Tầng 1',
      seats: 4,
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const b1 = created.body.item;
    assert.equal(b1.code, 'B1', 'code normalizes to upper case');
    const b1Token = tokenOf(b1.qrUrl);
    assert.ok(b1Token.length >= 40, 'QR token is unguessable-length');

    const bulk = await lan('POST', '/tables', {
      locationRef: 'Q1',
      bulk: { prefix: 'T', from: 1, to: 2, seats: 2 },
    });
    assert.equal(bulk.status, 200);
    assert.deepEqual(bulk.body.items.map((row) => row.code), ['T1', 'T2']);
    assert.equal(
      (await lan('POST', '/tables', { locationRef: 'Q1', code: 'B1', name: 'dup' })).status,
      400,
      'duplicate code per branch is a validation error',
    );
    assert.equal(
      (await other('POST', '/tables', { locationRef: 'Q1', code: 'X1', name: 'x' })).status,
      404,
      'out-of-scope branch cannot create tables',
    );
    assert.equal(
      (await noTables.as.reader('POST', '/tables', { locationRef: 'Q1', code: 'X2', name: 'x' }))
        .status,
      403,
      'table.manage is required',
    );

    // ── Public resolve: good token resolves, garbage is a plain 404 ─────────────────────
    const resolved = await api('GET', `/tables/${b1Token}`);
    assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
    assert.equal(resolved.body.item.branch, 'Q1');
    assert.equal(resolved.body.item.table.code, 'B1');
    assert.equal(resolved.body.item.status, 'available');
    assert.equal((await api('GET', '/tables/not-a-real-token')).status, 404);

    // ── Order create on the token: session opens, secret never persisted ────────────────
    const first = await place(b1Token);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const order1 = await app.db.query('plugin::ordering.order').findOne({
      where: { code: first.body.order.code },
      populate: { tableSession: true },
    });
    assert.equal(order1.receiveMethod.kind, 'dine-in');
    assert.equal(order1.receiveMethod.tableCode, 'B1');
    assert.equal(order1.receiveMethod.tableToken ?? null, null, 'QR secret is not stored');
    const session1 = order1.tableSession;
    assert.ok(session1?.id, 'first order opens a table session');
    assert.equal(session1.status, 'open');

    const second = await place(b1Token);
    const third = await place(b1Token);
    assert.equal(second.status, 201);
    assert.equal(third.status, 201);
    const sessionIds = new Set(
      (
        await app.db.query('plugin::ordering.order').findMany({
          where: { tableSession: session1.id },
          select: ['id'],
        })
      ).map((row) => row.id),
    );
    assert.equal(sessionIds.size, 3, 'three dine-in orders share one table session');

    // ── Concurrency: two simultaneous first orders on a fresh table → one session ───────
    const b2 = (
      await lan('POST', '/tables', { locationRef: 'Q1', code: 'B2', name: 'Bàn 2' })
    ).body.item;
    const b2Token = tokenOf(b2.qrUrl);
    const [raceA, raceB] = await Promise.all([place(b2Token), place(b2Token)]);
    assert.equal(raceA.status, 201, JSON.stringify(raceA.body));
    assert.equal(raceB.status, 201, JSON.stringify(raceB.body));
    const b2Table = await tables().findOne({ where: { code: 'B2' } });
    const b2Sessions = await sessions().findMany({ where: { table: b2Table.id } });
    assert.equal(b2Sessions.length, 1, 'concurrent first orders still yield one session');

    // ── Bad tokens: disabled, rotated, cross-branch ──────────────────────────────────────
    const t1 = bulk.body.items[0];
    const t1Token = tokenOf(t1.qrUrl);
    assert.equal((await lan('PUT', `/tables/${t1.id}`, { active: false })).status, 200);
    assert.equal((await api('GET', `/tables/${t1Token}`)).status, 404, 'disabled table 404s');
    assert.equal((await place(t1Token)).status, 404, 'disabled table cannot order');

    const rotated = await lan('POST', `/tables/${b1.id}/rotate-qr`, {});
    assert.equal(rotated.status, 200);
    const newToken = tokenOf(rotated.body.item.qrUrl);
    assert.notEqual(newToken, b1Token);
    assert.equal((await api('GET', `/tables/${b1Token}`)).status, 404, 'rotated token dies');
    assert.equal((await api('GET', `/tables/${newToken}`)).status, 200);

    assert.equal(
      (await place(b2Token, 'Q3')).status,
      404,
      'a Q1 token cannot order at another branch',
    );
    assert.equal(
      (await place('forged-token')).status,
      404,
      'unknown token cannot order',
    );

    // ── N7 board: session summary + permission gate ──────────────────────────────────────
    const board = await lan('GET', '/table-sessions?branch=Q1');
    assert.equal(board.status, 200);
    const card = board.body.items.find((row) => row.id === session1.id);
    assert.ok(card, 'session is on the board');
    assert.equal(card.orderCount, 3);
    assert.equal(card.awaitingAcceptance, 3);
    assert.ok(card.total > 0 && card.due === card.total, 'nothing collected yet');
    assert.equal(
      (await noTables.as.reader('GET', '/table-sessions?branch=Q1')).status,
      403,
      'table.manage is required on the board',
    );

    // ── Close: unfinished orders block with the offending codes ─────────────────────────
    const blocked = await lan('POST', `/table-sessions/${session1.id}/close`, { method: 'cash' });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'TABLE_SESSION_UNFINISHED');
    assert.equal(blocked.body.error.details.orders.length, 3);

    // Walk every order to `served`: accept → prepare → ready → serve.
    const orderRows = await app.db.query('plugin::ordering.order').findMany({
      where: { tableSession: session1.id },
      select: ['id', 'code'],
      orderBy: { id: 'asc' },
    });
    for (const row of orderRows) {
      const aggregate = await order.getOrder(row.id, systemCtx);
      for (const group of aggregate.groups) {
        assert.equal(group.workflowName, 'dine-in-pay-later');
        for (const to of ['preparing', 'ready', 'served']) {
          await transition.transitionGroup(
            { orderId: row.id, groupId: group.id, to },
            systemCtx,
          );
        }
      }
    }

    // A canceled order must not block or be charged: cancel order 3 before closing.
    const canceledId = orderRows[2].id;
    const canceledCode = orderRows[2].code;
    const canceledAgg = await order.getOrder(canceledId, systemCtx);
    for (const group of canceledAgg.groups) {
      await transition.transitionGroup(
        { orderId: canceledId, groupId: group.id, to: 'canceled' },
        systemCtx,
      );
    }
    const canceling = await lan('POST', `/table-sessions/${session1.id}/close`, { method: 'cash' });
    assert.equal(canceling.status, 200, 'canceled orders do not block the close');

    // ── Cash close: due collected per order, closer's actorRef on the session ───────────
    assert.equal(canceling.body.item.status, 'closed');
    assert.equal(canceling.body.item.method, 'cash');
    assert.ok(canceling.body.item.closedBy.startsWith('admin:'), 'closer is attributed');
    assert.equal(canceling.body.item.collected.length, 2, 'one collection per live order');
    assert.ok(
      canceling.body.item.collected.every((row) => row.code !== canceledCode),
      'the canceled order collects nothing',
    );
    const closedSession = await sessions().findOne({ where: { id: session1.id } });
    assert.equal(closedSession.status, 'closed');
    assert.equal(closedSession.closedBy, canceling.body.item.closedBy);
    for (const row of orderRows) {
      const aggregate = await order.getOrder(row.id, systemCtx);
      if (row.id === canceledId) {
        assert.equal(aggregate.order.status, 'canceled');
        continue;
      }
      assert.equal(aggregate.order.paymentStatus, 'paid', `order ${row.code} is paid`);
      assert.ok(
        aggregate.groups.every((group) => group.status === 'completed'),
        `order ${row.code} groups completed`,
      );
    }
    const cashPayments = await app.db.query('plugin::ordering.payment').findMany({
      where: { providerCode: 'cash' },
    });
    assert.equal(cashPayments.length, 2, 'exactly one cash payment per live order');

    // Idempotent: a second close answers the recorded summary, no new payments.
    const again = await lan('POST', `/table-sessions/${session1.id}/close`, { method: 'cash' });
    assert.equal(again.status, 200);
    assert.equal(again.body.item.alreadyClosed, true);
    assert.equal(again.body.item.collected.length, 0);
    assert.equal(
      (await app.db.query('plugin::ordering.payment').findMany({ where: { providerCode: 'cash' } }))
        .length,
      2,
      'no double collection',
    );

    // ── Autoclose: a stale open session only raises the alert — never closes, never pays ──
    const stale = await sessions().create({
      data: {
        table: b2Table.id,
        locationRef: 'Q1',
        status: 'open',
        openedAt: new Date(Date.now() - 30 * 60 * 60_000).toISOString(),
        businessDate: '2000-01-01',
      },
    });
    const owner = `test:${process.pid}`;
    const result = await runTableSessionAutoclose(app, { owner });
    assert.equal(result.ran, true);
    assert.equal(result.alerted, 1);
    const alert = await app.db.query('plugin::ordering.ops-alert').findOne({
      where: { dedupeKey: `table-session-open:${stale.id}` },
    });
    assert.ok(alert, 'table-session-open alert exists');
    const stillOpen = await sessions().findOne({ where: { id: stale.id } });
    assert.equal(stillOpen.status, 'open', 'the job never closes the session itself');
    assert.equal(
      (await app.db.query('plugin::ordering.payment').findMany({ where: { providerCode: 'cash' } }))
        .length,
      2,
      'the job collects nothing',
    );
    // Closing it resolves the alert on the next run.
    await sessions().update({ where: { id: stale.id }, data: { status: 'closed' } });
    const rerun = await runTableSessionAutoclose(app, { owner });
    assert.equal(rerun.resolved, 1, 'the alert resolves once the session closes');

    // ── Session bill: the canceled order is not printed (close did not collect it) ───────
    const bill = await app.plugin('ordering').service('print').forSession(session1.id, systemCtx);
    assert.equal(bill.orderCodes.length, 2, 'two live orders on the bill');
    assert.ok(!bill.orderCodes.includes(canceledCode), 'canceled order is off the bill');

    // ── Change-log never carries the QR link (it holds the live table token) ─────────────
    const tableLogs = await app.db.query('plugin::ordering.admin-change-log').findMany({
      where: { entityType: 'dining-table' },
    });
    assert.ok(tableLogs.length > 0, 'table changes are logged');
    const logText = JSON.stringify(tableLogs);
    assert.ok(!logText.includes('qrUrl'), 'no qrUrl in change-log');
    for (const token of [b1Token, newToken, t1Token, b2Token]) {
      assert.ok(!logText.includes(token), 'no table token in change-log');
    }

    // ── Transfer close: one bank reference, later orders `<ref>-<orderId>`, no stacking ──
    const b3 = (
      await lan('POST', '/tables', { locationRef: 'Q1', code: 'B3', name: 'Bàn 3' })
    ).body.item;
    const b3Token = tokenOf(b3.qrUrl);
    for (let i = 0; i < 3; i += 1) assert.equal((await place(b3Token)).status, 201);
    const b3Orders = await app.db.query('plugin::ordering.order').findMany({
      where: { tableSession: { table: { code: 'B3' } } },
      select: ['id', 'code'],
      orderBy: { id: 'asc' },
      populate: { tableSession: { select: ['id'] } },
    });
    assert.equal(b3Orders.length, 3);
    for (const row of b3Orders) {
      const aggregate = await order.getOrder(row.id, systemCtx);
      for (const group of aggregate.groups) {
        for (const to of ['preparing', 'ready', 'served']) {
          await transition.transitionGroup({ orderId: row.id, groupId: group.id, to }, systemCtx);
        }
      }
    }
    const b3Session = b3Orders[0].tableSession.id;
    const transferClose = await lan('POST', `/table-sessions/${b3Session}/close`, {
      method: 'transfer-at-counter',
      reference: 'CK-BAN3',
    });
    assert.equal(transferClose.status, 200, JSON.stringify(transferClose.body));
    assert.equal(transferClose.body.item.collected.length, 3);
    const manual = await app.db.query('plugin::ordering.payment-event').findMany({
      where: { providerCode: 'sepay', kind: 'manual' },
      orderBy: { id: 'asc' },
    });
    assert.deepEqual(
      manual.map((row) => row.providerTransactionId),
      ['CK-BAN3', `CK-BAN3-${b3Orders[1].id}`, `CK-BAN3-${b3Orders[2].id}`],
      'each later order gets one suffix on the base reference',
    );

    // ── sessionPayment 'at-close': every order goes pay-later, whatever paymentTiming says ──
    await branchRows.update({
      where: { id: q3.id },
      data: {
        fulfillment: {
          dineIn: {
            ...dineInOpen,
            paymentTiming: 'prepay',
            // No cash: an at-close order needs no provider, the closer picks the method.
            paymentProviders: ['sepay'],
            sessionPayment: 'at-close',
          },
        },
      },
    });
    const q3Table = (
      await other('POST', '/tables', { locationRef: 'Q3', code: 'C1', name: 'Bàn C1' })
    ).body.item;
    const atClose = await place(tokenOf(q3Table.qrUrl), 'Q3');
    assert.equal(atClose.status, 201, JSON.stringify(atClose.body));
    const atCloseOrder = await app.db.query('plugin::ordering.order').findOne({
      where: { code: atClose.body.order.code },
    });
    const atCloseAgg = await order.getOrder(atCloseOrder.id, systemCtx);
    assert.equal(atCloseAgg.groups[0].workflowName, 'dine-in-pay-later', 'at-close forces pay-later');
    assert.equal(atCloseAgg.groups[0].status, 'awaiting-acceptance');

    // ── per-order prepay: the storefront payment step reads dine-in providers, not pickup's ──
    await branchRows.update({
      where: { id: q3.id },
      data: {
        fulfillment: {
          dineIn: {
            ...dineInOpen,
            paymentTiming: 'prepay',
            paymentProviders: ['sepay'],
            sessionPayment: 'per-order',
          },
        },
      },
    });
    const prepaid = await api(
      'POST',
      '/orders',
      { ...orderBody(tokenOf(q3Table.qrUrl), 'Q3'), payment: { providerCode: 'sepay' } },
      key(),
    );
    assert.equal(prepaid.status, 201, JSON.stringify(prepaid.body));
    const prepaidView = await app
      .plugin('ordering')
      .service('storefront')
      .paymentByToken(prepaid.body.token);
    assert.ok(prepaidView.presentation, 'dine-in sepay shows the transfer QR (Q3 pickup has no sepay)');

    // ── QR svg + scope gate (raw fetch — the body is XML, not JSON) ──────────────────────
    const svgRes = await fetch(`${base}/ordering/tables/${b1.id}/qr.svg`, {
      headers: { Authorization: `Bearer ${await http.tokenOf('lan')}` },
    });
    assert.equal(svgRes.status, 200);
    assert.ok((await svgRes.text()).startsWith('<svg'), 'admin QR renders as svg');
    assert.equal((await other('GET', `/tables/${b1.id}/qr.svg`)).status, 404, 'out-of-scope 404');

    console.log(
      '[ordering-test] dine-in: table CRUD + QR rotate, token resolve, 3 orders/1 session, concurrent first-order, invalid/disabled/cross-branch, unfinished-close block, cash close + actor attribution, idempotent close, alert-only autoclose, bill skips canceled, no token in change-log, transfer-close references, at-close pay-later without cash, dine-in prepay presentation verified',
    );
  } finally {
    await http.cleanup();
    await noTables.cleanup();
  }
});
