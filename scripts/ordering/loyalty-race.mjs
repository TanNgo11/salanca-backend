// O16 step 4 — races on one customer's points. Every pair runs inside a widened window: the
// customer lock is wrapped so its holder sleeps 300 ms right after taking it. Checked: two orders
// spending the same points end with exactly one LOYALTY_INSUFFICIENT; a cancel's release and a new
// order's redeem finish without a deadlock; two releases of one order hand points back once; earning
// and spending at once keep balance = Σ ledger. The first scenario also runs with BOTH layers of
// locking switched off (customer advisory lock and the lots' FOR UPDATE) and must go red: the second
// debit then trips the `remaining >= 0` CHECK instead of a clean LOYALTY_INSUFFICIENT.
// Run: ORDERING_TEST_DATABASE=salanca_ordering_o16 node scripts/ordering/loyalty-race.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import { basicOrderInput, seedBranches, seedMenu, seedStaff, services, systemCtx, withApp } from './_harness.mjs';

const require = createRequire(import.meta.url);
const customerLock = require('../../src/plugins/ordering/dist/server/src/services/customer-lock.js');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DAY = 86_400_000;

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const staff = await seedStaff(app);
  const lanCtx = { actor: staff.lan.actor };
  const { order, loyaltySettings } = services(app);
  const plugin = app.plugin('ordering');
  const loyalty = plugin.service('loyalty');
  const adminOrders = plugin.service('admin-orders');
  const customers = () => app.db.query('plugin::ordering.customer');
  const lots = () => app.db.query('plugin::ordering.loyalty-lot');
  const ledger = () => app.db.query('plugin::ordering.loyalty-ledger');
  await loyaltySettings.put(
    { enabled: true, earnPerAmount: 10000, pointValue: 100, minRedeemPoints: 50, maxRedeemShare: 0.5, expiryMonths: 12,
      expiryReminderDays: 14, downgradeGraceDays: 30, dailyEarnCap: 100000, channels: ['pickup', 'delivery', 'dine-in'],
      countHistoryForTiers: true },
    systemCtx,
  );

  const realLock = customerLock.lockCustomer;
  const realForUpdate = app.db.connection.queryBuilder().constructor.prototype.forUpdate;
  /** Holder of the customer lock sleeps `ms` inside it; `off` drops both lock layers. */
  const widen = (ms, { off = false } = {}) => {
    customerLock.lockCustomer = async (trx, customer) => {
      if (!off) await realLock(trx, customer);
      await sleep(ms);
    };
    if (off) app.db.connection.queryBuilder().constructor.prototype.forUpdate = function noLock() { return this; };
    return () => {
      customerLock.lockCustomer = realLock;
      app.db.connection.queryBuilder().constructor.prototype.forUpdate = realForUpdate;
    };
  };

  let seq = 0;
  const newCustomer = async (grants) => {
    const phone = `+84903${String(1000000 + ++seq).slice(1)}`;
    const row = await customers().create({ data: { phone, phoneHash: `hash-${phone}`, status: 'active', name: 'Khách đua' } });
    await app.db.connection.transaction(async (trx) => {
      for (const [points, days] of grants) {
        const lot = await lots().create({
          data: { customerId: row.id, source: 'adjust', points, remaining: points, expiresAt: new Date(Date.now() + days * DAY) },
        });
        await loyalty.post(trx, { customerId: row.id, kind: 'adjust', points, lotId: lot.id, actorRef: 'test', at: new Date() });
      }
    });
    return { id: row.id, phone };
  };
  const place = (customer, redeemPoints, extra = {}) =>
    order.createOrder(
      { ...basicOrderInput({ adjustments: [], idempotencyKey: randomUUID(), contact: { name: 'Khách', phone: customer.phone }, customerId: customer.id, ...extra }), redeemPoints },
      systemCtx,
    );
  const balanceOf = async (id) => Number((await customers().findOne({ where: { id } })).pointsBalance);
  const assertLedger = async (id, label) => {
    const rows = await ledger().findMany({ where: { customerId: id } });
    assert.equal(rows.reduce((acc, row) => acc + row.points, 0), await balanceOf(id), `${label}: balance = Σ ledger`);
    const all = await lots().findMany({ where: { customerId: id } });
    for (const lot of all) assert.ok(lot.remaining >= 0 && lot.remaining <= lot.points, `${label}: lot bounds`);
    assert.equal(all.reduce((acc, lot) => acc + lot.remaining, 0), Math.max(0, await balanceOf(id)), `${label}: Σ remaining`);
  };
  const outcomeOf = (settled) => settled.map((row) => (row.status === 'fulfilled' ? 'ok' : (row.reason?.code ?? `raw:${row.reason?.message}`)));
  const dispatch = () => runOutboxDispatcher(app, { owner: `loyalty-race:${process.pid}` });

  // ── 1. Two orders spend the same 100 points ──────────────────────────────────────────────
  const doubleSpend = async (options) => {
    const customer = await newCustomer([[100, 30]]);
    const restore = widen(300, options);
    let settled;
    try {
      settled = await Promise.allSettled([place(customer, 100), place(customer, 100)]);
    } finally {
      restore();
    }
    return { customer, outcomes: outcomeOf(settled).sort() };
  };
  const guarded = await doubleSpend({});
  assert.deepEqual(guarded.outcomes, ['LOYALTY_INSUFFICIENT', 'ok'], 'locked: one wins, one is told there are not enough points');
  assert.equal(await balanceOf(guarded.customer.id), 0);
  await assertLedger(guarded.customer.id, 'double spend');
  console.log('[ordering-test] two orders on 100 points → one ok, one LOYALTY_INSUFFICIENT');

  const unguarded = await doubleSpend({ off: true });
  assert.notDeepEqual(unguarded.outcomes, ['LOYALTY_INSUFFICIENT', 'ok'], 'with locks off the race must show (this check must stay red)');
  assert.ok(unguarded.outcomes.some((entry) => entry === '23514'), `locks off → CHECK violation, got ${unguarded.outcomes}`);
  console.log(`[ordering-test] locks off → ${unguarded.outcomes.join(' / ')} (the check goes red as it should)`);

  // ── 2. A cancel's release and a new redeem on the same customer ─────────────────────────
  const two = await newCustomer([[400, 30], [400, 60]]);
  const first = await place(two, 300);
  const restore2 = widen(200);
  let pair;
  try {
    pair = await Promise.allSettled([
      adminOrders.cancel(first.order.order.id, { reasonCode: 'customer-request', note: 'đổi ý' }, lanCtx),
      place(two, 400),
    ]);
  } finally {
    restore2();
  }
  assert.deepEqual(outcomeOf(pair), ['ok', 'ok'], 'cancel and redeem finish without a deadlock');
  await dispatch();
  await loyalty.reconcileForOrder(first.order.order.id);
  assert.equal(await balanceOf(two.id), 800 - 400, 'first order fully released, second spent 400');
  await assertLedger(two.id, 'cancel vs redeem');
  console.log('[ordering-test] cancel release vs new redeem: no deadlock, balance 400');

  // ── 3. Two releases of one order hand points back once ─────────────────────────────────────
  const three = await newCustomer([[500, 30]]);
  const doomed = await place(three, 200);
  await app.db.connection('plugins_ordering_order').where({ id: doomed.order.order.id }).update({ status: 'canceled' });
  const restore3 = widen(200);
  try {
    const both = await Promise.all([
      loyalty.reconcileForOrder(doomed.order.order.id),
      loyalty.reconcileForOrder(doomed.order.order.id),
    ]);
    assert.deepEqual(both.map((row) => row.released).sort((a, b) => a - b), [0, 200]);
  } finally {
    restore3();
  }
  assert.equal(await balanceOf(three.id), 500);
  await assertLedger(three.id, 'double release');
  console.log('[ordering-test] two concurrent releases → points back exactly once');

  // ── 4. Earning and spending at the same moment ─────────────────────────────────────────────
  const four = await newCustomer([[300, 30]]);
  const done = await place(four, 0);
  const doneId = done.order.order.id;
  await app.db.connection('plugins_ordering_order').where({ id: doneId }).update({ status: 'completed', completed_at: new Date() });
  const restore4 = widen(200);
  let mixed;
  try {
    mixed = await Promise.allSettled([loyalty.earnForOrder(doneId), place(four, 250)]);
  } finally {
    restore4();
  }
  assert.deepEqual(outcomeOf(mixed), ['ok', 'ok']);
  assert.equal(await balanceOf(four.id), 300 - 250 + 22, '220.000 earns 22 points');
  await assertLedger(four.id, 'earn vs redeem');
  console.log('[ordering-test] earn and redeem together keep the ledger whole');

  console.log('[ordering-test] loyalty-race OK');
});
