// O16 step 5 — tiers. A customer moves up the moment an earn lifts the 12-month spend over a
// threshold (group O14 follows, congratulation mail once, webhook event); moving down needs the spend
// to stay under the threshold for the grace period (a mark is set, climbing back clears it); the
// tier job and `refreshAuto` never fight over membership; a promotion limited to a tier's group applies
// to its members only; "Tính lại hạng" imports 12 months of history once and respects the switch.
// Run: ORDERING_TEST_DATABASE=salanca_ordering_o16 node scripts/ordering/loyalty-tiers.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runLoyaltyTiers } from '../../src/plugins/ordering/dist/server/src/jobs/loyalty-tiers.js';
import { runOutboxDispatcher } from '../../src/plugins/ordering/dist/server/src/jobs/outbox-dispatcher.js';
import { basicOrderInput, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const DAY = 86_400_000;

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const { order, payment, transition, loyaltySettings, loyaltyTier } = services(app);
  const plugin = app.plugin('ordering');
  const loyalty = plugin.service('loyalty');
  const lifecycle = plugin.service('loyalty-lifecycle');
  const groups = plugin.service('customer-group');
  const capture = plugin.service('registry').notificationProvider('email');
  const customers = () => app.db.query('plugin::ordering.customer');
  const ledger = () => app.db.query('plugin::ordering.loyalty-ledger');
  const members = () => app.db.query('plugin::ordering.customer-group-member');

  const settingsBody = {
    enabled: true, earnPerAmount: 10000, pointValue: 100, minRedeemPoints: 50, maxRedeemShare: 0.5, expiryMonths: 12,
    expiryReminderDays: 14, downgradeGraceDays: 30, dailyEarnCap: 100000, channels: ['pickup', 'delivery', 'dine-in'],
    countHistoryForTiers: true,
  };
  await loyaltySettings.put(settingsBody, systemCtx);
  // Make Bạc reachable with one order: 100.000đ of merchandise in 12 months.
  const bac = (await loyaltyTier.list()).items.find((tier) => tier.code === 'bac');
  await loyaltyTier.update(
    bac.id,
    { code: 'bac', name: bac.name, minSpend12m: 100000, multiplier: 120, customerGroupCode: 'hang-bac', active: true },
    systemCtx,
  );
  const groupRows = () => app.db.query('plugin::ordering.customer-group').findMany({ where: { code: { $in: ['hang-bac', 'hang-vang'] } } });
  const groupId = async (code) => (await groupRows()).find((row) => row.code === code).documentId;
  const memberCodes = async (customerId) => {
    const rows = await members().findMany({ where: { customerId } });
    const all = await groupRows();
    return rows.map((row) => `${all.find((group) => group.documentId === row.groupDocumentId)?.code ?? '?'}:${row.source}`).sort();
  };

  let seq = 0;
  const newCustomer = async (extra = {}) => {
    const phone = `+84905${String(1000000 + ++seq).slice(1)}`;
    const row = await customers().create({
      data: {
        phone, phoneHash: `hash-${phone}`, status: 'active', name: 'Khách hạng', documentId: randomUUID().replaceAll('-', '').slice(0, 24),
        email: `hang${seq}@example.invalid`, marketingConsent: { granted: true }, ...extra,
      },
    });
    return { id: row.id, phone, email: row.email, documentId: row.documentId };
  };
  const complete = async (customer) => {
    const placed = await order.createOrder(
      basicOrderInput({ adjustments: [], idempotencyKey: randomUUID(), contact: { name: 'K', phone: customer.phone }, customerId: customer.id }),
      systemCtx,
    );
    const orderId = placed.order.order.id;
    const row = await payment.createPayment({ orderId, providerCode: 'test' }, systemCtx);
    await payment.capturePayment({ paymentId: row.id, amount: placed.order.order.totalAmount, providerTransactionId: randomUUID() }, systemCtx);
    const agg = await order.getOrder(orderId, systemCtx);
    for (const to of ['preparing', 'ready', 'delivered']) {
      await transition.transitionGroup({ orderId, groupId: agg.groups[0].id, to }, systemCtx);
    }
    return orderId;
  };
  const dispatch = () => runOutboxDispatcher(app, { owner: `loyalty-tiers:${process.pid}` });
  const tierOf = async (id) => (await customers().findOne({ where: { id } }));
  const jobNow = (offsetDays = 0) => runLoyaltyTiers(app, { owner: 'loyalty-tiers-test', now: new Date(Date.now() + offsetDays * DAY) });

  // ── A. Up the moment the earn crosses the threshold ──────────────────────────────────────
  const a = await newCustomer();
  const orderA = await complete(a);
  await loyalty.earnForOrder(orderA);
  let row = await tierOf(a.id);
  assert.equal(row.tierCode, 'bac', '220.000 ≥ 100.000 → Bạc at once');
  assert.equal(Number(row.spend12m), 220000);
  assert.deepEqual(await memberCodes(a.id), ['hang-bac:auto']);
  await dispatch();
  assert.equal(capture.sent.filter((mail) => mail.to === a.email).length, 0, 'first placement is not a congratulation');
  const events = await app.db.query('plugin::ordering.outbox').findMany({ where: { type: 'loyalty.tier.changed' } });
  assert.ok(events.length >= 1);
  console.log('[ordering-test] earn lifts spend over the threshold → Bạc + group hang-bac at once');

  // ── B. Moving up later mails the congratulation once, by webhook-safe payload ───────────────
  const b = await newCustomer();
  const orderB = await complete(b);
  await customers().update({ where: { id: b.id }, data: { tierCode: 'thanh-vien' } });
  await loyalty.earnForOrder(orderB);
  assert.equal((await tierOf(b.id)).tierCode, 'bac');
  await dispatch();
  const congrats = capture.sent.filter((mail) => mail.to === b.email);
  assert.equal(congrats.length, 1, 'moving up mails the congratulation');
  assert.match(congrats[0].subject, /Bạc/);
  await dispatch();
  assert.equal(capture.sent.filter((mail) => mail.to === b.email).length, 1, 'redelivery does not mail twice');
  const tierEvent = (await app.db.query('plugin::ordering.outbox').findMany({ where: { type: 'loyalty.tier.changed' } })).find(
    (event) => event.payload.customerId === b.id,
  );
  assert.equal(tierEvent.payload.customerDocumentId, b.documentId);
  console.log('[ordering-test] tier up → one congratulation mail, event carries the documentId only');

  // ── C. Promotion limited to a tier group: members only ───────────────────────────────────────
  await app.db.query('plugin::ordering.promotion').create({
    data: {
      name: { vi: 'Ưu đãi hạng Bạc' }, kind: 'auto', discountType: 'percent', value: 10, target: { kind: 'order', refs: [] },
      minSubtotal: 0, receiveKinds: ['pickup', 'delivery'], startsAt: '2026-01-01T00:00:00.000Z', weekdays: [], timeRanges: [],
      firstOrderOnly: false, customerGroups: ['hang-bac'], stackable: false, priority: 1, active: true, usedCount: 0,
    },
  });
  const outsider = await newCustomer();
  const quoteFor = (customer) =>
    order.quote(basicOrderInput({ adjustments: [], contact: { name: 'K', phone: customer.phone }, ...(customer ? { customerId: customer.id } : {}) }), systemCtx);
  const asMember = await quoteFor(a);
  const asOutsider = await quoteFor(outsider);
  const asGuest = await order.quote(basicOrderInput({ adjustments: [], contact: { name: 'K', phone: a.phone } }), systemCtx);
  assert.equal(asMember.promotions.length, 1, 'Bạc member gets the promotion');
  assert.equal(asMember.totals.grandTotal, 198000);
  assert.equal(asOutsider.promotions.length, 0);
  assert.equal(asGuest.promotions.length, 0, 'a guest holds no group, even with a member phone');
  console.log('[ordering-test] promotion customerGroups: member −10%, outsider and guest nothing');

  // ── D. Grace period before moving down; climbing back clears the mark ───────────────────────
  // Spend drops below the Bạc threshold when the earn leaves the 12-month window.
  const old = new Date(Date.now() - 400 * DAY);
  await ledger().updateMany({ where: { customerId: a.id }, data: { at: old } });
  const day0 = await jobNow(0);
  assert.equal(day0.ran, true);
  row = await tierOf(a.id);
  assert.equal(row.tierCode, 'bac', 'still Bạc: the grace has only started');
  assert.ok(row.tierBelowSince, 'below-threshold mark is set');
  assert.equal(Number(row.spend12m), 0);
  await jobNow(29);
  assert.equal((await tierOf(a.id)).tierCode, 'bac', '29 days: still Bạc');
  // Spend climbs back before the grace ends: the mark clears and nothing moves.
  await ledger().create({ data: { customerId: a.id, kind: 'history', points: 0, baseAmount: 150000, balanceAfter: 0, at: new Date(), actorRef: 'test' } });
  await jobNow(29);
  row = await tierOf(a.id);
  assert.equal(row.tierCode, 'bac');
  assert.equal(row.tierBelowSince ?? null, null, 'climbing back clears the mark');
  // Drops again and stays low the whole grace: moves down on day 30.
  await ledger().updateMany({ where: { customerId: a.id, kind: 'history' }, data: { at: old } });
  await jobNow(0);
  assert.ok((await tierOf(a.id)).tierBelowSince);
  await customers().update({ where: { id: a.id }, data: { tierBelowSince: new Date(Date.now() - 31 * DAY) } });
  const downDay = await jobNow(0);
  assert.equal(downDay.down, 1);
  row = await tierOf(a.id);
  assert.equal(row.tierCode, 'thanh-vien');
  assert.equal(row.tierBelowSince ?? null, null);
  assert.deepEqual(await memberCodes(a.id), [], 'the base tier has no group: hang-bac membership is removed');
  console.log('[ordering-test] grace: mark set, cleared on climb back, 31 days below → Thành viên, group removed');

  // ── E. refreshAuto never removes a tier member; manual members survive the tier job ─────────
  await loyalty.earnForOrder(await complete(a));
  assert.equal((await tierOf(a.id)).tierCode, 'bac');
  const manual = await newCustomer();
  await members().create({
    data: { customerId: manual.id, customerDocumentId: manual.documentId, groupDocumentId: await groupId('hang-vang'), source: 'manual' },
  });
  await groups.refreshAuto(new Date());
  assert.deepEqual(await memberCodes(a.id), ['hang-bac:auto'], 'refreshAuto leaves tier groups alone');
  await jobNow(0);
  assert.deepEqual(await memberCodes(manual.id), ['hang-vang:manual'], 'a staff-added member is not touched');
  console.log('[ordering-test] refreshAuto and the tier job leave each other (and manual members) alone');

  // ── F. History import: once, only when allowed ────────────────────────────────────────────
  const h = await newCustomer();
  const hOrder = await complete(h);
  await app.db.connection('plugins_ordering_order').where({ id: hOrder }).update({ completed_at: new Date(Date.now() - 90 * DAY) });
  await loyaltySettings.put({ ...settingsBody, countHistoryForTiers: false }, systemCtx);
  assert.deepEqual(await lifecycle.recalculateHistory(new Date()), { orders: 0, customers: 0 });
  await loyaltySettings.put(settingsBody, systemCtx);
  const first = await lifecycle.recalculateHistory(new Date());
  assert.ok(first.orders >= 1);
  const rows = await ledger().findMany({ where: { orderId: hOrder } });
  assert.deepEqual(rows.map((row2) => [row2.kind, row2.points, Number(row2.baseAmount)]), [['history', 0, 220000]]);
  assert.equal((await tierOf(h.id)).tierCode, 'bac', 'history lifted the tier');
  const second = await lifecycle.recalculateHistory(new Date());
  assert.equal(second.orders, 0, 'idempotent');
  assert.equal((await ledger().findMany({ where: { orderId: hOrder } })).length, 1);
  // The sweep must not also earn that order: it already has a history row, but a later earn is allowed? No:
  // history marks it as counted for tiers; earning stays blocked by startsAt (completed before the program).
  assert.equal((await loyalty.earnForOrder(hOrder)).reason, 'before-start');
  console.log('[ordering-test] history import: 0-point row per order, tier lifted, rerun adds none');

  console.log('[ordering-test] loyalty-tiers OK');
});
