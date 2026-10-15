// O6 step 3: end-of-day cash closing — per-collector branch/day summary, close with a
// mandatory note on differences, unique "current" row under concurrency, the
// cash-closing-mismatch alert + scoped e-mail, reasoned adjustments and the 04:00
// business-date cutoff.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import { seedAdminHttpStaff, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const owner = `test:${process.pid}`;

const zone = {
  code: 'near',
  label: 'Gần',
  priority: 10,
  match: { kind: 'commune', communeCodes: ['XT01001', 'XT01002'] },
  rules: [
    { when: 'subtotal-lt', subtotal: 100000, fee: 'unavailable' },
    { when: 'subtotal-lt', subtotal: 300000, fee: 15000 },
    { when: 'any', fee: 0 },
  ],
  minOrderAmount: 100000,
  extraLeadTimeMinutes: 30,
};

const ADDRESS = {
  communeCode: 'XT01002',
  line1: '12 Đường Bí Mật',
  recipientName: 'Người Thử',
  phone: '0901234567',
};

const orderInput = (locationRef, lines, overrides = {}) => ({
  idempotencyKey: randomUUID(),
  locationRef,
  locale: 'vi',
  lines,
  receiveMethod: { kind: 'pickup', locationRef },
  contact: { name: 'Khách test', phone: '+84900000001' },
  consent: { policyVersion: 'v1', channel: 'web-checkout' },
  origin: { kind: 'storefront' },
  ...overrides,
});

/** Two-phase barrier: `await promise` in one flow, `resolve()` in the other. */
const gate = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const move = async (call, orderId, to, extra = {}) => {
  const res = await call('POST', `/orders/${orderId}/transition`, { to, ...extra });
  assert.equal(res.status, 200, `transition ${to} must succeed (${JSON.stringify(res.body)})`);
};

const handover = async (call, orderId) => {
  const res = await call('POST', `/orders/${orderId}/cash-handover`, { method: 'cash' });
  assert.equal(res.status, 200, `cash-handover must succeed (${JSON.stringify(res.body)})`);
};

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const plugin = app.plugin('ordering');
  const { order } = services(app);
  const adminOrders = plugin.service('admin-orders');
  const today = await adminOrders.todayFor('Q1');
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayDate = yesterday.toISOString().slice(0, 10);
  const closingRows = () => app.db.query('plugin::ordering.cash-closing');
  const alertRows = () => app.db.query('plugin::ordering.ops-alert');
  const capture = plugin.service('registry').notificationProvider('email');

  // Q1 also delivers (the courier's collection must belong to the courier, not the clicker).
  const branches = app.db.query('plugin::ordering.branch');
  const q1 = await branches.findOne({ where: { code: 'Q1' } });
  await branches.update({
    where: { id: q1.id },
    data: {
      fulfillment: {
        pickup: { enabled: true, paymentTiming: 'pay-on-pickup' },
        delivery: {
          enabled: true,
          orderTiming: 'both',
          paymentTiming: 'pay-on-pickup',
          paymentProviders: ['cash'],
          minOrderAmount: 0,
          schedule: {
            leadTimeMinutes: 60,
            slotLengthMinutes: 15,
            capacity: 8,
            openingHours: { mode: '24_7' },
          },
          zones: [zone],
        },
      },
    },
  });

  await app.listen();

  // Lowercase names: the admin login lowercases the stored email verbatim.
  const ops = await seedAdminHttpStaff(app, {
    actions: ['order.read', 'order.process', 'payment.record-cash', 'refund.manage', 'report.read'],
    scopes: {
      quanly: { allLocations: false, locationRefs: ['Q1'] },
      nvq3: { allLocations: false, locationRefs: ['Q3'] },
    },
  });
  const accounting = await seedAdminHttpStaff(app, {
    actions: ['report.read'],
    scopes: { ketoan: { allLocations: true, locationRefs: [] } },
  });
  // The courier collects cash but holds no report permission — the mismatch mail must not
  // reach them (only report.read users inside the branch scope).
  const courier = await seedAdminHttpStaff(app, {
    actions: ['order.read', 'order.process', 'payment.record-cash'],
    scopes: { nvgiao: { allLocations: false, locationRefs: ['Q1'] } },
  });

  const quanlyRef = `admin:${ops.users.quanly.id}`;
  const nvgiaoRef = `admin:${courier.users.nvgiao.id}`;
  const nvq3Ref = `admin:${ops.users.nvq3.id}`;
  const summary = (call, branch, day) =>
    call('GET', `/cash-closing?branch=${branch}&businessDate=${day}`);

  try {
    // ── 1. Cash collections per collector ───────────────────────────────────────
    const pickupA = (await order.createOrder(
      orderInput('Q1', [{ sellableUid: 'bun-bo', quantity: 2 }]),
      systemCtx,
    )).order.order.id;
    const pickupB = (await order.createOrder(
      orderInput('Q1', [{ sellableUid: 'tra-dao', quantity: 1 }]),
      systemCtx,
    )).order.order.id;
    for (const id of [pickupA, pickupB]) {
      await move(ops.as.quanly, id, 'preparing');
      await move(ops.as.quanly, id, 'ready');
      await handover(ops.as.quanly, id);
    }
    const deliveryId = (await order.createOrder(
      orderInput('Q1', [{ sellableUid: 'bun-bo', quantity: 2 }], {
        receiveMethod: { kind: 'delivery', address: ADDRESS },
      }),
      systemCtx,
    )).order.order.id;
    await move(ops.as.quanly, deliveryId, 'preparing');
    await move(ops.as.quanly, deliveryId, 'ready');
    await move(ops.as.quanly, deliveryId, 'out-for-delivery', { assigneeRef: nvgiaoRef });
    await handover(courier.as.nvgiao, deliveryId);

    const first = await summary(ops.as.quanly, 'Q1', today);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const rowOf = (body, ref) => body.rows.find((row) => row.collectorRef === ref);
    const quanlyRow = rowOf(first.body, quanlyRef);
    const nvgiaoRow = rowOf(first.body, nvgiaoRef);
    assert.ok(quanlyRow, 'quanly must collect on two pickup orders');
    assert.ok(nvgiaoRow, 'the courier must collect the delivery order');
    assert.equal(quanlyRow.orderCount, 2);
    assert.equal(quanlyRow.systemAmount, 175000); // 130.000 + 45.000
    assert.equal(nvgiaoRow.orderCount, 1);
    assert.equal(nvgiaoRow.systemAmount, 145000); // 130.000 + 15.000 phí giao theo vùng
    assert.equal(quanlyRow.collectorName, 'quanly HTTP');
    const dbSum = await app.db.connection('plugins_ordering_payment')
      .sum('captured_amount as total')
      .where({ provider_code: 'cash', status: 'captured', business_date: today })
      .first();
    assert.equal(
      first.body.totals.systemAmount,
      Number(dbSum.total),
      'summary totals must equal Σ payment.captured_amount',
    );
    console.log('[ordering-test] summary: 2 pickup (quanly) + 1 delivery (nvgiao), totals match DB');

    // ── 2. Partial cash refund lowers the expected amount ───────────────────────
    const refund = await ops.as.quanly('POST', `/orders/${pickupA}/refunds`, {
      method: 'cash',
      amount: 30000,
      reason: 'khách đổi món',
    });
    assert.equal(refund.status, 200, JSON.stringify(refund.body));
    const [refundRow] = await app.db.query('plugin::ordering.refund').findMany({
      orderBy: { id: 'desc' },
      limit: 1,
    });
    assert.equal(String(refundRow.businessDate), today, 'settled cash refund gets today as business date');
    const afterRefund = await summary(ops.as.quanly, 'Q1', today);
    const quanlyRefunded = rowOf(afterRefund.body, quanlyRef);
    assert.equal(quanlyRefunded.refundAmount, 30000);
    assert.equal(quanlyRefunded.expectedAmount, 145000);
    console.log('[ordering-test] refund: refundAmount 30.000, expected 145.000, businessDate set');

    // ── 3. Scope: Q3 staff cannot see Q1, all-location accounting can ───────────
    const denied = await summary(ops.as.nvq3, 'Q1', today);
    assert.equal(denied.status, 404, 'out-of-scope branch must answer 404');
    const allowed = await summary(accounting.as.ketoan, 'Q1', today);
    assert.equal(allowed.status, 200);
    console.log('[ordering-test] scope: nvq3 → 404, ketoan → 200');

    // ── 4. Exact close succeeds once; the repeat loses to 409 ───────────────────
    const closed = await ops.as.quanly('POST', '/cash-closing', {
      branch: 'Q1',
      businessDate: today,
      collectorRef: quanlyRef,
      countedAmount: 145000,
    });
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    assert.equal(closed.body.closing.differenceAmount, 0);
    assert.equal(closed.body.closing.revision, 1);
    assert.equal(closed.body.closing.closedBy, quanlyRef);
    const duplicate = await ops.as.quanly('POST', '/cash-closing', {
      branch: 'Q1',
      businessDate: today,
      collectorRef: quanlyRef,
      countedAmount: 145000,
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, 'CASH_CLOSING_EXISTS');
    assert.equal(
      (await alertRows().findMany({ where: { dedupeKey: `cash-closing-mismatch:Q1:${today}:${quanlyRef}` } }))
        .length,
      0,
      'a zero-difference close must not open a mismatch alert',
    );
    console.log('[ordering-test] close: 200 once, 409 duplicate, no alert on zero diff');

    // ── 5. Difference needs a note, opens the alert, mails the scoped reporters ──
    const noNote = await accounting.as.ketoan('POST', '/cash-closing', {
      branch: 'Q1',
      businessDate: today,
      collectorRef: nvgiaoRef,
      countedAmount: 125000,
    });
    assert.equal(noNote.status, 400);
    assert.equal(noNote.body.error.details.field, 'note');
    const short = await accounting.as.ketoan('POST', '/cash-closing', {
      branch: 'Q1',
      businessDate: today,
      collectorRef: nvgiaoRef,
      countedAmount: 125000,
      note: 'thiếu 20.000, tài xế hứa bù sáng mai',
    });
    assert.equal(short.status, 200, JSON.stringify(short.body));
    assert.equal(short.body.closing.differenceAmount, -20000);
    const mismatchKey = `cash-closing-mismatch:Q1:${today}:${nvgiaoRef}`;
    const mismatch = await alertRows().findOne({ where: { dedupeKey: mismatchKey } });
    assert.ok(mismatch, 'the shortage must open the mismatch alert');
    assert.equal(mismatch.status, 'open');

    capture.sent.length = 0;
    await runOutboxDispatcher(app, { owner });
    const opsMails = capture.sent.filter((mail) => mail.template === 'staff.ops-alert');
    const recipients = new Set(opsMails.map((mail) => mail.to));
    assert.ok(recipients.has(ops.users.quanly.email), 'quanly (report.read, Q1) is notified');
    assert.ok(recipients.has(accounting.users.ketoan.email), 'ketoan (report.read, all) is notified');
    assert.ok(!recipients.has(ops.users.nvq3.email), 'nvq3 (out of scope) is not notified');
    assert.ok(!recipients.has(courier.users.nvgiao.email), 'nvgiao (no report.read) is not notified');
    assert.equal(opsMails.length, 2, 'exactly the two scoped reporters are mailed');
    const mailCount = capture.sent.length;
    await runOutboxDispatcher(app, { owner });
    assert.equal(capture.sent.length, mailCount, 'a second dispatch must not resend');
    console.log('[ordering-test] mismatch: note enforced, alert open, scoped mail once');

    // ── 6. Two simultaneous closes race: exactly one wins ────────────────────────
    const q3Order = (await order.createOrder(
      orderInput('Q3', [{ sellableUid: 'goi-cuon', quantity: 4 }]),
      systemCtx,
    )).order.order.id;
    await move(ops.as.nvq3, q3Order, 'preparing');
    await move(ops.as.nvq3, q3Order, 'ready');
    await handover(ops.as.nvq3, q3Order);
    const raced = await Promise.all([
      ops.as.nvq3('POST', '/cash-closing', {
        branch: 'Q3', businessDate: today, collectorRef: nvq3Ref, countedAmount: 60000,
      }),
      ops.as.nvq3('POST', '/cash-closing', {
        branch: 'Q3', businessDate: today, collectorRef: nvq3Ref, countedAmount: 60000,
      }),
    ]);
    const statuses = raced.map((res) => res.status).sort();
    assert.deepEqual(statuses, [200, 409], 'concurrent closes: one wins, one gets CASH_CLOSING_EXISTS');
    console.log('[ordering-test] concurrency: exactly one close wins the race');

    // ── 7. Adjustment supersedes, resolves the alert, needs a reason ─────────────
    const nvgiaoClosingId = short.body.closing.id;
    const noReason = await accounting.as.ketoan('POST', `/cash-closing/${nvgiaoClosingId}/adjust`, {
      countedAmount: 145000,
    });
    assert.equal(noReason.status, 400);
    assert.equal(noReason.body.error.details.field, 'reason');
    const adjusted = await accounting.as.ketoan('POST', `/cash-closing/${nvgiaoClosingId}/adjust`, {
      countedAmount: 145000,
      note: 'tài xế bù đủ',
      reason: 'tài xế trả bù 20.000',
    });
    assert.equal(adjusted.status, 200, JSON.stringify(adjusted.body));
    assert.equal(adjusted.body.closing.revision, 2);
    assert.equal(adjusted.body.closing.differenceAmount, 0);
    assert.equal(adjusted.body.closing.supersedesId, nvgiaoClosingId);
    const oldRow = await closingRows().findOne({ where: { id: nvgiaoClosingId } });
    assert.equal(oldRow.status, 'superseded', 'the old closing is kept as superseded');
    const resolved = await alertRows().findOne({ where: { dedupeKey: mismatchKey } });
    assert.equal(resolved.status, 'resolved', 'a zero-diff adjustment resolves the alert');
    console.log('[ordering-test] adjust: revision 2, old superseded, alert resolved');

    // ── 8. Business-date cutoff: a 01:30 order belongs to yesterday ──────────────
    const late = (await order.createOrder(
      orderInput('Q1', [{ sellableUid: 'tra-dao', quantity: 1 }], {
        placedAt: `${today}T01:30:00+07:00`,
      }),
      systemCtx,
    )).order.order.id;
    const lateOrder = await order.getOrder(late, systemCtx);
    assert.equal(
      String(lateOrder.order.businessDate),
      yesterdayDate,
      'placed at 01:30 VN before the 04:00 cutoff belongs to yesterday',
    );
    await move(ops.as.quanly, late, 'preparing');
    await move(ops.as.quanly, late, 'ready');
    await handover(ops.as.quanly, late);
    const todaySummary = await summary(accounting.as.ketoan, 'Q1', today);
    const yesterdaySummary = await summary(accounting.as.ketoan, 'Q1', yesterdayDate);
    const lateRef = `admin:${ops.users.quanly.id}`;
    const todayCollector = rowOf(todaySummary.body, lateRef);
    const yesterdayCollector = rowOf(yesterdaySummary.body, lateRef);
    assert.equal(todayCollector.orderCount, 2, 'today is unchanged (still the two pickups)');
    assert.equal(todayCollector.systemAmount, 175000);
    assert.ok(yesterdayCollector, 'the 01:30 order shows in yesterday');
    assert.equal(yesterdayCollector.orderCount, 1);
    assert.equal(yesterdayCollector.systemAmount, 45000);
    console.log('[ordering-test] boundary: 01:30 order lands on yesterday, not today');

    // ── 9. A refund leaves the collector's float, not the clicker's ─────────────
    // The courier collected the delivery order; the manager presses "hoàn tiền" later. The
    // courier's day is already closed: the refund still goes through (the customer is owed the
    // money) but it opens the mismatch alert so the sealed closing is never silently stale.
    const courierRefund = await ops.as.quanly('POST', `/orders/${deliveryId}/refunds`, {
      method: 'cash',
      amount: 20000,
      reason: 'giao thiếu món',
    });
    assert.equal(courierRefund.status, 200, JSON.stringify(courierRefund.body));
    const afterCourierRefund = await summary(accounting.as.ketoan, 'Q1', today);
    const courierRow = rowOf(afterCourierRefund.body, nvgiaoRef);
    assert.equal(courierRow.refundAmount, 20000, 'the refund is charged to the courier who collected');
    assert.equal(courierRow.expectedAmount, 125000);
    assert.equal(
      rowOf(afterCourierRefund.body, quanlyRef).refundAmount,
      30000,
      'the manager who pressed refund only carries their own pickup refund',
    );
    const lateAlerts = await app.db.query('plugin::ordering.ops-alert').findMany({
      where: { dedupeKey: `cash-closing-mismatch:Q1:${today}:${nvgiaoRef}` },
    });
    assert.ok(
      lateAlerts.some((row) => row.status === 'open' || row.status === 'acknowledged'),
      'a refund after close raises the mismatch alert',
    );
    console.log('[ordering-test] refund attribution: courier 20.000 + late-close alert, manager unchanged 30.000');

    // ── 10. A cash capture racing the close: never a silent gap ──────────────────
    // Every cash posting and every `close` take the same bucket advisory lock, so exactly two
    // outcomes are legal when they overlap: the closing contains the capture, or the closing was
    // sealed first and the capture opens the mismatch alert. Both orders are pinned with a
    // barrier here — a closing that silently misses the money is the defect (audit L-01).
    const racers = await seedAdminHttpStaff(app, {
      actions: ['order.read', 'order.process', 'payment.record-cash', 'report.read'],
      scopes: {
        race1: { allLocations: false, locationRefs: ['Q1'] },
        race2: { allLocations: false, locationRefs: ['Q1'] },
        race3: { allLocations: false, locationRefs: ['Q1'] },
      },
    });
    const race1Ref = `admin:${racers.users.race1.id}`;
    const race2Ref = `admin:${racers.users.race2.id}`;
    const race3Ref = `admin:${racers.users.race3.id}`;
    const cashClosing = plugin.service('cash-closing');
    const originalNote = cashClosing.noteCashPosting.bind(cashClosing);
    const readyOrder = async (call) => {
      const id = (await order.createOrder(
        orderInput('Q1', [{ sellableUid: 'tra-dao', quantity: 1 }]),
        systemCtx,
      )).order.order.id;
      await move(call, id, 'preparing');
      await move(call, id, 'ready');
      return id;
    };
    try {
      // 10a. The capture is inside its transaction holding the bucket lock when `close` starts.
      const lockedOrder = await readyOrder(racers.as.race1);
      const tookLock = gate();
      const releaseCapture = gate();
      cashClosing.noteCashPosting = async (...args) => {
        await originalNote(...args); // this is what takes the bucket lock
        tookLock.resolve();
        await releaseCapture.promise;
      };
      const capturing = handover(racers.as.race1, lockedOrder);
      await tookLock.promise;
      const closingWhileHeld = racers.as.race1('POST', '/cash-closing', {
        branch: 'Q1', businessDate: today, collectorRef: race1Ref, countedAmount: 45000,
      });
      releaseCapture.resolve();
      await capturing;
      const sealed = await closingWhileHeld;
      cashClosing.noteCashPosting = originalNote;
      assert.equal(sealed.status, 200, JSON.stringify(sealed.body));
      assert.equal(sealed.body.closing.orderCount, 1, 'the closing must include the capture');
      assert.equal(sealed.body.closing.systemAmount, 45000);
      assert.equal(sealed.body.closing.differenceAmount, 0, 'no silent gap: the count matches');
      assert.equal(
        (await alertRows().findMany({
          where: { dedupeKey: `cash-closing-mismatch:Q1:${today}:${race1Ref}` },
        })).length,
        0,
        'a closing that includes the capture opens no alert',
      );
      console.log('[ordering-test] race close↔capture: capture held the lock → closing includes it');

      // 10b. The close finishes first: the capture must not land silently, it opens the alert.
      const lateOrder = await readyOrder(racers.as.race2);
      const beforeLock = gate();
      const releaseLate = gate();
      cashClosing.noteCashPosting = async (...args) => {
        beforeLock.resolve();
        await releaseLate.promise; // stopped before the lock, exactly like a late capture
        return originalNote(...args);
      };
      const lateCapture = handover(racers.as.race2, lateOrder);
      await beforeLock.promise;
      const sealedFirst = await racers.as.race2('POST', '/cash-closing', {
        branch: 'Q1', businessDate: today, collectorRef: race2Ref, countedAmount: 0,
      });
      assert.equal(sealedFirst.status, 200, JSON.stringify(sealedFirst.body));
      assert.equal(sealedFirst.body.closing.systemAmount, 0, 'the closing was sealed before the cash');
      releaseLate.resolve();
      await lateCapture;
      cashClosing.noteCashPosting = originalNote;
      const race2Key = `cash-closing-mismatch:Q1:${today}:${race2Ref}`;
      const lateAlert = await alertRows().findMany({ where: { dedupeKey: race2Key } });
      const sealedRow = await closingRows().findOne({
        where: { locationRef: 'Q1', businessDate: today, collectorRef: race2Ref, status: 'current' },
      });
      assert.equal(lateAlert.length, 1, 'cash after the seal must open exactly one alert');
      assert.equal(lateAlert[0].status, 'open');
      assert.equal(Number(sealedRow.systemAmount), 0, 'the snapshot itself is not rewritten');
      assert.equal(Number(sealedRow.expectedAmount), 0, 'the sealed row keeps its own numbers');
      console.log('[ordering-test] race close↔capture: cash after the seal → alert, never silent');

      // 11. `adjust` while a cash capture is in flight must stay non-silent (round-7 audit).
      // `adjust` recomputes the same bucket, so a capture parked inside its own transaction (bucket
      // lock held, not committed) is invisible to it and the new revision can exclude money that is
      // about to land — the round-7 record shows closing 45.000 against a ledger of 90.000. What
      // must never happen is a stale revision with no signal: the capture opens the mismatch alert
      // inside that same transaction, and `adjust` cannot clear a row it cannot see.
      const race3Order = await readyOrder(racers.as.race3);
      await handover(racers.as.race3, race3Order);
      const sealedRace3 = await racers.as.race3('POST', '/cash-closing', {
        branch: 'Q1', businessDate: today, collectorRef: race3Ref, countedAmount: 45000,
      });
      assert.equal(sealedRace3.status, 200, JSON.stringify(sealedRace3.body));
      const parked = gate();
      const releaseParked = gate();
      cashClosing.noteCashPosting = async (...args) => {
        await originalNote(...args);
        parked.resolve();
        await releaseParked.promise;
      };
      const parkedOrder = await readyOrder(racers.as.race3);
      const parkedCapture = handover(racers.as.race3, parkedOrder);
      await parked.promise;
      const adjusting = racers.as.race3('POST', `/cash-closing/${sealedRace3.body.closing.id}/adjust`, {
        countedAmount: 45000,
        note: 'đếm lại quỹ',
        reason: 'đếm lại quỹ giữa lúc thu tiền',
      });
      await new Promise((done) => setTimeout(done, 1500));
      releaseParked.resolve();
      await parkedCapture;
      const adjustedRace3 = await adjusting;
      cashClosing.noteCashPosting = originalNote;
      const race3Closing = await closingRows().findOne({
        where: { locationRef: 'Q1', businessDate: today, collectorRef: race3Ref, status: 'current' },
      });
      const race3Alerts = await alertRows().findMany({
        where: { dedupeKey: `cash-closing-mismatch:Q1:${today}:${race3Ref}` },
      });
      const race3Ledger = await app.db
        .connection('plugins_ordering_payment')
        .sum('captured_amount as total')
        .where({ provider_code: 'cash', status: 'captured', business_date: today, actor_ref: race3Ref })
        .first();
      const race3Closed = Number(race3Closing.systemAmount);
      const race3Held = Number(race3Ledger.total);
      const race3Signal = race3Alerts.some((row) => row.status === 'open' || row.status === 'acknowledged');
      console.log(
        `[ordering-test] race adjust↔capture: adjust=${adjustedRace3.status} closing=${race3Closed} ledger=${race3Held} alerts=${race3Alerts.map((row) => row.status).join(',') || 'none'}`,
      );
      assert.equal(adjustedRace3.status, 200, JSON.stringify(adjustedRace3.body));
      assert.ok(
        race3Closed === race3Held || race3Signal,
        'a current closing either matches the ledger or carries an open mismatch alert',
      );
    } finally {
      cashClosing.noteCashPosting = originalNote;
      await racers.cleanup();
    }

    // Change-log records exist for close + adjust.
    const logs = await app.db.query('plugin::ordering.admin-change-log').findMany({
      where: { action: { $in: ['cash-closing.close', 'cash-closing.adjust'] } },
    });
    assert.ok(logs.filter((row) => row.action === 'cash-closing.close').length >= 3);
    assert.ok(logs.filter((row) => row.action === 'cash-closing.adjust').length >= 1);

    console.log('[ordering-test] cash-closing: all checks passed');
  } finally {
    await ops.cleanup();
    await accounting.cleanup();
    await courier.cleanup();
  }
});
