// O16 step 4 — spending points. Quote never throws (it reports `reason`), create names the error;
// the discount is a fixed `loyalty` adjustment after promotions and before fees, capped at the
// configured share of the food; points come off the soonest-expiring lot first; canceling the whole
// order hands them back to the original lots (a lot that expired meanwhile becomes a 30-day restore
// lot); canceling one line does not; a staff edit that shrinks the food pulls the discount down to the
// new ceiling and returns the difference.
// Run: ORDERING_TEST_DATABASE=salanca_ordering_o16 node scripts/ordering/loyalty-redeem.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runLoyaltyEarnSweep } from '../../src/plugins/ordering/dist/server/src/jobs/loyalty-earn-sweep.js';
import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import { basicOrderInput, seedBranches, seedMenu, seedStaff, services, systemCtx, withApp } from './_harness.mjs';

const DAY = 86_400_000;

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const staff = await seedStaff(app);
  const lanCtx = { actor: staff.lan.actor };
  const { order, loyaltySettings, lineCancel } = services(app);
  const plugin = app.plugin('ordering');
  const loyalty = plugin.service('loyalty');
  const adminOrders = plugin.service('admin-orders');
  const edit = plugin.service('order-edit');
  const customers = () => app.db.query('plugin::ordering.customer');
  const lots = () => app.db.query('plugin::ordering.loyalty-lot');
  const ledger = () => app.db.query('plugin::ordering.loyalty-ledger');

  await loyaltySettings.put(
    { enabled: true, earnPerAmount: 10000, pointValue: 100, minRedeemPoints: 50, maxRedeemShare: 0.5, expiryMonths: 12,
      expiryReminderDays: 14, downgradeGraceDays: 30, dailyEarnCap: 2000, channels: ['pickup', 'delivery', 'dine-in'],
      countHistoryForTiers: true },
    systemCtx,
  );

  let seq = 0;
  const phone = () => `+84902${String(1000000 + ++seq).slice(1)}`;
  const dispatch = () => runOutboxDispatcher(app, { owner: `loyalty-redeem:${process.pid}` });
  const codeOf = async (run) => {
    try {
      await run();
    } catch (error) {
      return { code: error.code, details: error.details };
    }
    return null;
  };

  /** An active customer holding `grants` = [[points, daysToExpiry], …] as separate lots. */
  const newCustomer = async (grants) => {
    const p = phone();
    const row = await customers().create({
      data: { phone: p, phoneHash: `hash-${p}`, status: 'active', name: 'Khách điểm' },
    });
    await app.db.connection.transaction(async (trx) => {
      for (const [points, days] of grants) {
        const lot = await lots().create({
          data: { customerId: row.id, source: 'adjust', points, remaining: points, expiresAt: new Date(Date.now() + days * DAY) },
        });
        await loyalty.post(trx, { customerId: row.id, kind: 'adjust', points, lotId: lot.id, actorRef: 'test', at: new Date() });
      }
    });
    return { id: row.id, phone: p };
  };
  const balanceOf = async (id) => Number((await customers().findOne({ where: { id } })).pointsBalance);
  const lotsOf = async (id) => (await lots().findMany({ where: { customerId: id }, orderBy: { id: 'asc' } }));
  const input = (customer, extra = {}) =>
    basicOrderInput({
      adjustments: [],
      idempotencyKey: randomUUID(),
      contact: { name: 'Khách', phone: customer.phone },
      customerId: customer.id,
      ...extra,
    });
  const assertLedger = async (id, label) => {
    const rows = await ledger().findMany({ where: { customerId: id } });
    assert.equal(rows.reduce((acc, row) => acc + row.points, 0), await balanceOf(id), `${label}: balance = Σ ledger`);
    const all = await lotsOf(id);
    for (const lot of all) assert.ok(lot.remaining >= 0 && lot.remaining <= lot.points, `${label}: lot ${lot.id} bounds`);
    assert.equal(all.reduce((acc, lot) => acc + lot.remaining, 0), Math.max(0, await balanceOf(id)), `${label}: Σ remaining`);
  };

  // Food 220.000 → ceiling 110.000 = 1.100 points.
  const rich = await newCustomer([[300, 10], [200, 40], [1000, 90]]);

  // ── A. Quote reports, never throws ─────────────────────────────────────────────────────
  const q = await order.quote({ ...input(rich), redeemPoints: 100 }, systemCtx);
  assert.deepEqual(q.loyalty.applied, { points: 100, amount: 10000 });
  assert.deepEqual(q.loyalty.redeemable, { min: 50, max: 1100, value: 100 });
  assert.equal(q.loyalty.balance, 1500);
  assert.equal(q.loyalty.earnPreview.points, 21, 'earns on 220.000 − 10.000 = 210.000');
  assert.equal(q.totals.grandTotal, 210000);
  const refused = async (customer, points, extra = {}) =>
    (await order.quote({ ...input(customer, extra), redeemPoints: points }, systemCtx)).loyalty;
  assert.equal((await refused(rich, 49)).reason, 'below-minimum');
  assert.equal((await refused(rich, 1101)).reason, 'over-cap');
  assert.equal((await refused(rich, 100, { customerId: undefined })).reason, 'not-logged-in');
  assert.equal((await refused(rich, 100, { customerId: undefined })).loginRequired, true);
  const poor = await newCustomer([[60, 10]]);
  assert.equal((await refused(poor, 80)).reason, 'insufficient');
  const unverified = await newCustomer([[500, 10]]);
  await customers().update({ where: { id: unverified.id }, data: { status: 'unverified' } });
  assert.equal((await refused(unverified, 100)).reason, 'not-verified');
  console.log('[ordering-test] quote: applied/redeemable/earnPreview; below-minimum, over-cap, not-logged-in, insufficient, not-verified');

  // ── B. Create: errors are named and nothing is spent ─────────────────────────────────────
  assert.equal((await codeOf(() => order.createOrder({ ...input(rich), redeemPoints: 49 }, systemCtx))).code, 'LOYALTY_REDEEM_INVALID');
  assert.equal((await codeOf(() => order.createOrder({ ...input(poor), redeemPoints: 80 }, systemCtx))).code, 'LOYALTY_INSUFFICIENT');
  assert.equal(
    (await codeOf(() => order.createOrder({ ...input(rich, { customerId: undefined }), redeemPoints: 100 }, systemCtx))).code,
    'LOYALTY_NOT_LOGGED_IN',
  );
  assert.equal(await balanceOf(rich.id), 1500);

  // ── C. Create 350 points: FIFO across lots, one ledger row per lot ───────────────────────
  const placed = await order.createOrder({ ...input(rich), redeemPoints: 350 }, systemCtx);
  const orderId = placed.order.order.id;
  assert.equal(placed.order.order.totalAmount, 220000 - 35000);
  const adj = placed.order.adjustments.find((row) => row.sourceRef === 'loyalty');
  assert.equal(Number(adj.amount), -35000);
  assert.equal(adj.priority, 900);
  assert.equal(await balanceOf(rich.id), 1150);
  const [l1, l2, l3] = await lotsOf(rich.id);
  assert.deepEqual([l1.remaining, l2.remaining, l3.remaining], [0, 150, 1000], 'soonest-expiring lot first');
  const redeems = await ledger().findMany({ where: { orderId, kind: 'redeem' }, orderBy: { id: 'asc' } });
  assert.deepEqual(redeems.map((row) => [row.lotId, row.points]), [[l1.id, -300], [l2.id, -50]]);
  await assertLedger(rich.id, 'C');
  console.log('[ordering-test] redeem 350 → lot 300 + lot 50, discount −35.000 (priority 900)');

  // ── D. Cancel the whole order: points return to the original lots ─────────────────────────
  await adminOrders.cancel(orderId, { reasonCode: 'customer-request', note: 'đổi ý' }, lanCtx);
  await dispatch();
  assert.equal(await balanceOf(rich.id), 1500);
  const afterCancel = await lotsOf(rich.id);
  assert.deepEqual(afterCancel.map((lot) => lot.remaining), [300, 200, 1000]);
  const releases = await ledger().findMany({ where: { orderId, kind: 'release' } });
  assert.equal(releases.reduce((acc, row) => acc + row.points, 0), 350);
  await loyalty.reconcileForOrder(orderId);
  await loyalty.reconcileForOrder(orderId);
  assert.equal(await balanceOf(rich.id), 1500, 'replaying the release adds nothing');
  assert.deepEqual(await loyalty.pendingReleaseOrderIds(50), []);
  await assertLedger(rich.id, 'D');
  console.log('[ordering-test] cancel → 350 points back to lots 300/50; replay is a no-op');

  // ── E. A lot that expired meanwhile is replaced by a 30-day restore lot ───────────────────
  const e = await newCustomer([[200, 5], [500, 60]]);
  const ePlaced = await order.createOrder({ ...input(e), redeemPoints: 150 }, systemCtx);
  const eLot = (await lotsOf(e.id))[0];
  await lots().update({ where: { id: eLot.id }, data: { expiresAt: new Date(Date.now() - DAY) } });
  await adminOrders.cancel(ePlaced.order.order.id, { reasonCode: 'customer-request', note: 'x' }, lanCtx);
  await dispatch();
  const eLots = await lotsOf(e.id);
  const restore = eLots.find((lot) => lot.source === 'restore');
  assert.ok(restore, 'a restore lot exists');
  assert.equal(restore.points, 150);
  assert.equal(restore.remaining, 150);
  const days = (new Date(restore.expiresAt).getTime() - Date.now()) / DAY;
  assert.ok(days > 29 && days < 31, 'restore lot lives 30 days');
  assert.equal(eLots.find((lot) => lot.id === eLot.id).remaining, 50, 'the expired lot keeps only what was never spent');
  const eRelease = await ledger().findOne({ where: { orderId: ePlaced.order.order.id, kind: 'release' } });
  assert.equal(eRelease.originLotId, eLot.id);
  console.log('[ordering-test] expired original lot → restore lot, +30 days');

  // ── F. Canceling one line returns money by allocation, not points ─────────────────────────
  const f = await newCustomer([[1000, 30]]);
  const fPlaced = await order.createOrder({ ...input(f), redeemPoints: 200 }, systemCtx);
  const fTea = fPlaced.order.lines.find((line) => line.sellableUid === 'tra-dao');
  await lineCancel.cancelLineQuantity({ orderId: fPlaced.order.order.id, lineId: fTea.id, quantity: 1, reason: 'het tra' }, systemCtx);
  await dispatch();
  await loyalty.reconcileForOrder(fPlaced.order.order.id);
  assert.equal(await balanceOf(f.id), 800, 'a line cancel does not hand points back');
  assert.equal((await ledger().findMany({ where: { customerId: f.id, kind: 'release' } })).length, 0);

  // ── G. A staff edit that shrinks the food pulls the discount to the new ceiling ───────────
  const g = await newCustomer([[1000, 30]]);
  const gPlaced = await order.createOrder(
    { ...input(g, { lines: [{ sellableUid: 'bun-bo', quantity: 2 }] }), redeemPoints: 600 },
    systemCtx,
  );
  // 2 × 65.000 = 130.000 → ceiling 650 points; spending 600 is allowed.
  assert.equal(await balanceOf(g.id), 400);
  const bunBo = gPlaced.order.lines[0];
  await edit.edit(gPlaced.order.order.id, { revision: 0, reason: 'bot mot bun bo', reduce: [{ lineId: bunBo.id, quantity: 1 }] }, systemCtx);
  await dispatch();
  const gAfter = await order.getOrder(gPlaced.order.order.id, systemCtx);
  const gAdj = gAfter.adjustments.find((row) => row.sourceRef === 'loyalty');
  // 65.000 left → ceiling 325 points, so 275 points go back.
  assert.equal(Number(gAdj.amount), -32500);
  assert.equal(gAdj.ruleSnapshot.loyalty.points, 325);
  assert.equal(await balanceOf(g.id), 400 + 275);
  assert.equal(gAfter.order.totalAmount, 65000 - 32500);
  await loyalty.reconcileForOrder(gPlaced.order.order.id);
  assert.equal(await balanceOf(g.id), 675, 'idempotent');
  await assertLedger(g.id, 'G');
  console.log('[ordering-test] edit: 600 → 325 points, 275 returned, order total 32.500');

  // ── H. Disabled program: refuse create, quote says disabled, nothing spent ─────────────────
  const { startsAt: _stamp, ...current } = await loyaltySettings.get();
  await loyaltySettings.put({ ...current, enabled: false }, systemCtx);
  assert.equal((await refused(rich, 100)).reason, 'disabled');
  assert.equal((await codeOf(() => order.createOrder({ ...input(rich), redeemPoints: 100 }, systemCtx))).code, 'LOYALTY_DISABLED');
  await loyaltySettings.put({ ...current, enabled: true }, systemCtx);

  // ── I. Sweep releases a canceled order whose event never ran ──────────────────────────────
  const i = await newCustomer([[400, 30]]);
  const iPlaced = await order.createOrder({ ...input(i), redeemPoints: 100 }, systemCtx);
  await app.db.connection('plugins_ordering_order').where({ id: iPlaced.order.order.id }).update({ status: 'canceled' });
  assert.deepEqual(await loyalty.pendingReleaseOrderIds(50), [iPlaced.order.order.id]);
  await runLoyaltyEarnSweep(app, { owner: 'sweep-release', now: new Date() });
  assert.equal(await balanceOf(i.id), 400);
  assert.deepEqual(await loyalty.pendingReleaseOrderIds(50), []);
  await assertLedger(i.id, 'I');
  console.log('[ordering-test] sweep releases a cancel that emitted no event');

  // ── J. A canceled order that spent points cannot be reopened (round 8) ───────────────────
  // The cancel handed the points back but a reopen keeps the loyalty discount: without the refusal
  // the customer would hold both. The late transfer stays in review for a refund.
  const j = await newCustomer([[600, 30]]);
  const jPlaced = await order.createOrder({ ...input(j), redeemPoints: 350 }, systemCtx);
  const jOrderId = jPlaced.order.order.id;
  await adminOrders.cancel(jOrderId, { reasonCode: 'customer-request', note: 'đổi ý' }, lanCtx);
  await dispatch();
  assert.equal(await balanceOf(j.id), 600);
  const jEvent = await app.db.query('plugin::ordering.payment-event').create({
    data: {
      providerCode: 'sepay',
      providerTransactionId: `LOYALTY-REOPEN-${randomUUID()}`,
      transferType: 'in',
      amount: jPlaced.order.order.totalAmount,
      currency: 'VND',
      kind: 'transfer',
      rawPayload: { source: 'test', content: jPlaced.order.order.code },
      receivedAt: new Date(),
      reviewStatus: 'needs-review',
      reviewReason: 'order-closed',
    },
  });
  const jReopen = await codeOf(() =>
    plugin.service('payment-review').reopen(jEvent.id, { orderId: jOrderId, reason: 'khách chuyển muộn' }, { actor: staff.keToan.actor }),
  );
  assert.equal(jReopen.code, 'REOPEN_UNAVAILABLE', 'points were returned, so the discount cannot come back');
  assert.equal((await order.getOrder(jOrderId, systemCtx)).order.status, 'canceled');
  assert.equal(await balanceOf(j.id), 600, 'the refused reopen spends nothing');
  assert.equal((await app.db.query('plugin::ordering.payment-event').findOne({ where: { id: jEvent.id } })).reviewStatus, 'needs-review');
  await assertLedger(j.id, 'J');
  console.log('[ordering-test] reopen after a points cancel is refused; transfer stays in review');

  console.log('[ordering-test] loyalty-redeem OK');
});
