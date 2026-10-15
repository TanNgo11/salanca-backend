// O16 step 3 — earning and clawing back points. Points come only from a completed order of an
// `active` customer, on the merchandise after promotions (no fee/rounding/units canceled before
// completion), once per order whether the outbox consumer, the sweep or four parallel callers get
// there first. An order that earns 0 still gets its row; refunds claw points back telescopically and
// idempotently, also when they settled before the earn; a negative balance is a debt later credit pays.
// Run: ORDERING_TEST_DATABASE=salanca_ordering_o16 node scripts/ordering/loyalty-earn.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runLoyaltyEarnSweep } from '../../src/plugins/ordering/dist/server/src/jobs/loyalty-earn-sweep.js';
import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import { basicOrderInput, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const MONTH_MS = 30 * 86_400_000;

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const { order, payment, transition, refund, lineCancel, loyaltySettings } = services(app);
  const loyalty = app.plugin('ordering').service('loyalty');
  const customers = () => app.db.query('plugin::ordering.customer');
  const ledgerRows = () => app.db.query('plugin::ordering.loyalty-ledger');
  const lotRows = () => app.db.query('plugin::ordering.loyalty-lot');

  let phoneSeq = 0;
  const newPhone = () => `+84901${String(1000000 + ++phoneSeq).slice(1)}`;
  const settings = (over = {}) =>
    loyaltySettings.put(
      {
        enabled: true,
        earnPerAmount: 10000,
        pointValue: 100,
        minRedeemPoints: 50,
        maxRedeemShare: 0.5,
        expiryMonths: 12,
        expiryReminderDays: 14,
        downgradeGraceDays: 30,
        dailyEarnCap: 2000,
        channels: ['pickup', 'delivery', 'dine-in'],
        countHistoryForTiers: true,
        ...over,
      },
      systemCtx,
    );

  /** Places a 195.000 order for `phone`; the customer profile is created `unverified` by the link. */
  const place = (phone, overrides = {}) =>
    order.createOrder(basicOrderInput({ idempotencyKey: randomUUID(), contact: { name: 'Khách', phone }, ...overrides }), systemCtx);
  const customerOf = async (phone) => customers().findOne({ where: { phone } });
  const activate = async (phone) => {
    const row = await customerOf(phone);
    await customers().update({ where: { id: row.id }, data: { status: 'active' } });
    return row.id;
  };
  const payFull = async (orderId, amount = 195000) => {
    const row = await payment.createPayment({ orderId, providerCode: 'test' }, systemCtx);
    await payment.capturePayment({ paymentId: row.id, amount, providerTransactionId: randomUUID() }, systemCtx);
    return row;
  };
  const complete = async (placed, { amount } = {}) => {
    const orderId = placed.order.order.id;
    const paid = await payFull(orderId, amount);
    const agg = await order.getOrder(orderId, systemCtx);
    for (const to of ['preparing', 'ready', 'delivered']) {
      await transition.transitionGroup({ orderId, groupId: agg.groups[0].id, to }, systemCtx);
    }
    assert.equal((await order.getOrder(orderId, systemCtx)).order.status, 'completed');
    return { orderId, payment: paid };
  };
  const dispatch = () => runOutboxDispatcher(app, { owner: `loyalty-earn:${process.pid}` });
  const sweep = () => runLoyaltyEarnSweep(app, { owner: 'loyalty-earn-sweep', now: new Date(Date.now() + 120_000) });
  const earnRows = async (orderId) => ledgerRows().findMany({ where: { orderId, kind: 'earn' } });
  const balanceOf = async (customerId) => Number((await customers().findOne({ where: { id: customerId } })).pointsBalance);

  /** balance = Σ ledger; Σ remaining = max(0, balance); 0 ≤ remaining ≤ points. */
  const assertInvariants = async (customerId, label) => {
    const rows = await ledgerRows().findMany({ where: { customerId } });
    const sum = rows.reduce((acc, row) => acc + Number(row.points), 0);
    const customer = await customers().findOne({ where: { id: customerId } });
    assert.equal(Number(customer.pointsBalance), sum, `${label}: balance = Σ ledger`);
    const lots = await lotRows().findMany({ where: { customerId } });
    for (const lot of lots) {
      assert.ok(lot.remaining >= 0 && lot.remaining <= lot.points, `${label}: lot ${lot.id} within 0..points`);
    }
    assert.equal(
      lots.reduce((acc, lot) => acc + lot.remaining, 0),
      Math.max(0, sum),
      `${label}: Σ remaining = max(0, balance)`,
    );
  };
  const allCustomers = [];

  // ── A. Program off: a completed order earns nothing ──────────────────────────────────
  const phoneA = newPhone();
  const a0 = await complete(await place(phoneA));
  const idA = await activate(phoneA);
  assert.deepEqual(await loyalty.earnForOrder(a0.orderId), { status: 'skipped', reason: 'disabled' });
  assert.equal((await ledgerRows().findMany({ where: { customerId: idA } })).length, 0);
  console.log('[ordering-test] program off → no points');

  // ── B. Switched on: an order completed before startsAt never earns (no back-dating) ───────
  await new Promise((done) => setTimeout(done, 30));
  await settings();
  assert.equal((await loyalty.earnForOrder(a0.orderId)).reason, 'before-start');

  // ── C. Unverified customer: nothing; once active the sweep earns, exactly once ──────────
  const phoneC = newPhone();
  const c1 = await complete(await place(phoneC));
  await dispatch();
  const customerC = await customerOf(phoneC);
  assert.equal(customerC.status, 'unverified');
  assert.equal((await earnRows(c1.orderId)).length, 0, 'an unverified customer does not earn');
  assert.deepEqual(await loyalty.earnForOrder(c1.orderId), { status: 'skipped', reason: 'customer-not-active' });
  const idC = await activate(phoneC);
  allCustomers.push(idC);
  const swept = await sweep();
  assert.equal(swept.ran, true);
  assert.ok(swept.earned >= 1);
  const [earn] = await earnRows(c1.orderId);
  assert.equal(earn.points, 19, '195.000 / 10.000 floored');
  assert.equal(Number(earn.baseAmount), 195000);
  assert.equal(earn.balanceAfter, 19);
  const [lot] = await lotRows().findMany({ where: { orderId: c1.orderId } });
  assert.equal(lot.source, 'earn');
  assert.equal(lot.points, 19);
  assert.equal(lot.remaining, 19);
  const months = (new Date(lot.expiresAt).getTime() - Date.now()) / MONTH_MS;
  assert.ok(months > 11.8 && months < 12.2, 'the lot lives 12 months');
  const profileC = await customers().findOne({ where: { id: idC } });
  assert.equal(profileC.pointsBalance, 19);
  assert.equal(Number(profileC.spend12m), 195000);
  assert.equal(profileC.tierCode, 'thanh-vien', 'the first earn places the customer in the base tier');
  await sweep();
  await dispatch();
  assert.equal((await earnRows(c1.orderId)).length, 1, 'sweep and consumer replays do not earn twice');
  console.log('[ordering-test] unverified skipped; after OTP the sweep earns 19 once, lot +12 months, base tier');

  // ── D. Four callers at once: one earn ───────────────────────────────────────────────────
  const c2 = await complete(await place(phoneC));
  const racers = await Promise.all([1, 2, 3, 4].map(() => loyalty.earnForOrder(c2.orderId)));
  assert.equal(racers.filter((r) => r.status === 'earned').length, 1);
  assert.equal(racers.filter((r) => r.reason === 'already-earned').length, 3);
  assert.equal((await earnRows(c2.orderId)).length, 1);
  assert.equal(await balanceOf(idC), 38);
  await assertInvariants(idC, 'C');

  // ── E. The tier multiplier applies (Bạc ×1.2) ─────────────────────────────────────────────
  await customers().update({ where: { id: idC }, data: { tierCode: 'bac' } });
  const c3 = await complete(await place(phoneC));
  assert.equal((await loyalty.earnForOrder(c3.orderId)).points, 23, 'floor(195.000 × 1.2 / 10.000)');
  await customers().update({ where: { id: idC }, data: { tierCode: 'thanh-vien' } });

  // ── F. Daily cap: the excess of a day is dropped ──────────────────────────────────────────
  await settings({ dailyEarnCap: 30 });
  const phoneP = newPhone();
  const p1 = await complete(await place(phoneP));
  const idP = await activate(phoneP);
  allCustomers.push(idP);
  assert.equal((await loyalty.earnForOrder(p1.orderId)).points, 19);
  const p2 = await complete(await place(phoneP));
  const capped = await loyalty.earnForOrder(p2.orderId);
  assert.deepEqual([capped.points, capped.capped], [11, true], 'only 11 of 19 fit under the cap of 30');
  const p3 = await complete(await place(phoneP));
  const dry = await loyalty.earnForOrder(p3.orderId);
  assert.equal(dry.points, 0);
  const [dryRow] = await earnRows(p3.orderId);
  assert.equal(dryRow.points, 0, 'a capped-out order still gets its row');
  assert.equal(Number(dryRow.baseAmount), 195000, 'and keeps its base for the tier');
  assert.equal((await lotRows().findMany({ where: { orderId: p3.orderId } })).length, 0, 'no lot for 0 points');
  assert.deepEqual(await loyalty.pendingEarnOrderIds(50, new Date(Date.now() + 120_000)), [], 'nothing left for the sweep');
  assert.equal(Number((await customers().findOne({ where: { id: idP } })).spend12m), 3 * 195000);
  await settings();
  console.log('[ordering-test] tier ×1.2 → 23; daily cap drops the excess; 0-point earn leaves a row');

  // ── G. Completion with no outbox event is caught by the sweep ─────────────────────────────
  const phoneG = newPhone();
  const g = await place(phoneG);
  const idG = await activate(phoneG);
  allCustomers.push(idG);
  await app.db
    .connection('plugins_ordering_order')
    .where('id', g.order.order.id)
    .update({ status: 'completed', completed_at: new Date() });
  await sweep();
  const [gEarn] = await earnRows(g.order.order.id);
  assert.equal(gEarn.points, 19);

  // ── H. Units canceled before completion are not in the base, and not reversed either ──────
  const phoneH = newPhone();
  const hPlaced = await place(phoneH);
  const idH = await activate(phoneH);
  allCustomers.push(idH);
  const hOrderId = hPlaced.order.order.id;
  await payFull(hOrderId);
  const tea = hPlaced.order.lines.find((line) => line.sellableUid === 'tra-dao');
  const canceled = await lineCancel.cancelLineQuantity(
    { orderId: hOrderId, lineId: tea.id, quantity: 1, reason: 'het tra dao' },
    systemCtx,
  );
  assert.equal(canceled.refundAmount, 39886);
  const hAgg = await order.getOrder(hOrderId, systemCtx);
  for (const to of ['preparing', 'ready', 'delivered']) {
    await transition.transitionGroup({ orderId: hOrderId, groupId: hAgg.groups[0].id, to }, systemCtx);
  }
  await dispatch();
  await sweep();
  const [hEarn] = await earnRows(hOrderId);
  assert.equal(Number(hEarn.baseAmount), 195000 - 39886, 'the canceled tea is outside the base');
  assert.equal(hEarn.points, 15);
  assert.deepEqual(
    (await ledgerRows().findMany({ where: { customerId: idH } })).map((row) => row.kind),
    ['earn'],
    'the cancel refund is not clawed back a second time',
  );
  console.log('[ordering-test] sweep catches an event-less completion; canceled tea outside base, no reverse row');

  // ── I. Refunds claw points back: telescoping, idempotent, whole refund = whole earn ───────
  const phoneI = newPhone();
  const iPlaced = await place(phoneI);
  const idI = await activate(phoneI);
  allCustomers.push(idI);
  const iDone = await complete(iPlaced);
  assert.equal((await loyalty.earnForOrder(iDone.orderId)).points, 19);
  const refundBy = async (amount) =>
    refund.createRefund(
      { paymentId: iDone.payment.id, amount, reason: 'khach tra mon', idempotencyKey: randomUUID() },
      systemCtx,
    );
  await refundBy(100000);
  const profileI1 = await customers().findOne({ where: { id: idI } });
  assert.equal(profileI1.pointsBalance, 9, 'round(19 × 100.000 / 195.000) = 10 taken back');
  assert.equal(Number(profileI1.spend12m), 95000, 'the refunded merchandise leaves the tier spend');
  await app.db.transaction(async ({ trx }) => {
    assert.equal(await loyalty.reverseForOrder(trx, iDone.orderId), 0, 're-running the hook takes nothing');
  });
  await refundBy(95000);
  const profileI2 = await customers().findOne({ where: { id: idI } });
  assert.equal(profileI2.pointsBalance, 0, 'refunding everything reverses exactly what was earned');
  assert.equal(Number(profileI2.spend12m), 0);
  const reverses = await ledgerRows().findMany({ where: { customerId: idI, kind: 'reverse' } });
  assert.deepEqual(reverses.map((row) => row.points).sort((x, y) => x - y), [-10, -9]);
  assert.equal(reverses.reduce((acc, row) => acc + Number(row.baseAmount ?? 0), 0), -195000);
  await assertInvariants(idI, 'I');
  console.log('[ordering-test] refunds 100.000 + 95.000 reverse 10 + 9 = 19; replay takes nothing');

  // ── J. Points already spent: the balance goes negative, later credit pays the debt first ───
  const phoneJ = newPhone();
  const jPlaced = await place(phoneJ);
  const idJ = await activate(phoneJ);
  allCustomers.push(idJ);
  const jDone = await complete(jPlaced);
  await loyalty.earnForOrder(jDone.orderId);
  // Emulate a redemption (step 4 does it for real): the lot is empty, the balance drops to 0.
  await app.db.connection('plugins_ordering_loyalty_lot').where({ customer_id: idJ }).update({ remaining: 0 });
  await app.db.connection('plugins_ordering_customer').where({ id: idJ }).update({ points_balance: 0 });
  await ledgerRows().create({
    data: { customerId: idJ, kind: 'redeem', points: -19, balanceAfter: 0, at: new Date(), actorRef: 'test' },
  });
  await refund.createRefund(
    { paymentId: jDone.payment.id, amount: 195000, reason: 'tra het', idempotencyKey: randomUUID() },
    systemCtx,
  );
  assert.equal(await balanceOf(idJ), -19, 'spent points cannot be taken from a lot: the balance is a debt');
  const debt = await ledgerRows().findMany({ where: { customerId: idJ, kind: 'reverse' } });
  assert.deepEqual(debt.map((row) => [row.points, row.lotId]), [[-19, null]]);
  await assertInvariants(idJ, 'J debt');
  const j2 = await complete(await place(phoneJ));
  assert.equal((await loyalty.earnForOrder(j2.orderId)).points, 19);
  const [j2Lot] = await lotRows().findMany({ where: { orderId: j2.orderId } });
  assert.deepEqual([j2Lot.points, j2Lot.remaining], [19, 0], 'the 19 new points pay the 19-point debt');
  assert.equal(await balanceOf(idJ), 0);
  await assertInvariants(idJ, 'J paid');
  console.log('[ordering-test] negative balance after a spent-point refund; the next earn pays it off');

  // ── K. A refund that settled before the earn is reversed in the same pass ─────────────────
  const phoneK = newPhone();
  const kPlaced = await place(phoneK);
  const kDone = await complete(kPlaced);
  await refund.createRefund(
    { paymentId: kDone.payment.id, amount: 195000, reason: 'hoan truoc', idempotencyKey: randomUUID() },
    systemCtx,
  );
  const idK = await activate(phoneK);
  allCustomers.push(idK);
  await sweep();
  const kRows = await ledgerRows().findMany({ where: { customerId: idK } });
  assert.deepEqual(kRows.map((row) => row.kind).sort(), ['earn', 'reverse']);
  assert.equal(await balanceOf(idK), 0);
  await assertInvariants(idK, 'K');
  console.log('[ordering-test] refund before earn: earn 19 and reverse −19 land together');

  for (const id of allCustomers) await assertInvariants(id, `customer ${id}`);
  console.log('[ordering-test] loyalty-earn OK');
});
