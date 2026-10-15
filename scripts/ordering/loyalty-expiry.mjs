// O16 step 5 — lot expiry, the one-time reminder and erasure. The daily job writes off only lots past
// their date (`expire` row per lot, balance = Σ ledger keeps holding) and is idempotent; the
// oldest-expiring lot is spent first so what expires is what is left; one reminder mail per lot,
// only for consented customers with an email; a switched-off program expires nothing; Decree 13 erase
// forfeits what is left and empties the lots; the access export lists balance, lots and ledger.
// Run: ORDERING_TEST_DATABASE=salanca_ordering_o16 node scripts/ordering/loyalty-expiry.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runLoyaltyExpiry } from '../../src/plugins/ordering/dist/server/src/jobs/loyalty-expiry.js';
import { basicOrderInput, seedBranches, seedMenu, services, systemCtx, withApp } from './_harness.mjs';

const DAY = 86_400_000;

withApp(async (app) => {
  await seedBranches(app);
  seedMenu(app);
  const { order, loyaltySettings } = services(app);
  const plugin = app.plugin('ordering');
  const loyalty = plugin.service('loyalty');
  const capture = plugin.service('registry').notificationProvider('email');
  const customers = () => app.db.query('plugin::ordering.customer');
  const lots = () => app.db.query('plugin::ordering.loyalty-lot');
  const ledger = () => app.db.query('plugin::ordering.loyalty-ledger');

  const settingsBody = {
    enabled: true, earnPerAmount: 10000, pointValue: 100, minRedeemPoints: 50, maxRedeemShare: 0.5, expiryMonths: 12,
    expiryReminderDays: 14, downgradeGraceDays: 30, dailyEarnCap: 2000, channels: ['pickup', 'delivery', 'dine-in'],
    countHistoryForTiers: true,
  };
  await loyaltySettings.put(settingsBody, systemCtx);

  let seq = 0;
  /** `grants` = [[points, daysFromNow]] — negative days are already past. */
  const newCustomer = async (grants, extra = {}) => {
    const phone = `+84904${String(1000000 + ++seq).slice(1)}`;
    const row = await customers().create({
      data: {
        phone, phoneHash: `hash-${phone}`, status: 'active', name: 'Khách hạn', documentId: randomUUID().replaceAll('-', '').slice(0, 24),
        email: `khach${seq}@example.invalid`, marketingConsent: { granted: true }, ...extra,
      },
    });
    await app.db.connection.transaction(async (trx) => {
      for (const [points, days] of grants) {
        const lot = await lots().create({
          data: { customerId: row.id, source: 'adjust', points, remaining: points, expiresAt: new Date(Date.now() + days * DAY) },
        });
        await loyalty.post(trx, { customerId: row.id, kind: 'adjust', points, lotId: lot.id, actorRef: 'test', at: new Date() });
      }
    });
    return { id: row.id, phone, email: row.email };
  };
  const balanceOf = async (id) => Number((await customers().findOne({ where: { id } })).pointsBalance);
  const lotsOf = async (id) => lots().findMany({ where: { customerId: id }, orderBy: { id: 'asc' } });
  const assertLedger = async (id, label) => {
    const rows = await ledger().findMany({ where: { customerId: id } });
    assert.equal(rows.reduce((acc, row) => acc + row.points, 0), await balanceOf(id), `${label}: balance = Σ ledger`);
    const all = await lotsOf(id);
    assert.equal(all.reduce((acc, lot) => acc + lot.remaining, 0), Math.max(0, await balanceOf(id)), `${label}: Σ remaining`);
  };
  const run = () => runLoyaltyExpiry(app, { owner: 'loyalty-expiry-test', now: new Date() });
  const mailsTo = (email) => capture.sent.filter((mail) => mail.to === email);

  // ── A. Oldest lot is spent first, so only what is left expires ───────────────────────────
  const a = await newCustomer([[100, 5], [200, 60]]);
  const [lotA, lotB] = await lotsOf(a.id);
  const placed = await order.createOrder(
    { ...basicOrderInput({ adjustments: [], idempotencyKey: randomUUID(), contact: { name: 'Khách', phone: a.phone }, customerId: a.id }), redeemPoints: 120 },
    systemCtx,
  );
  assert.deepEqual((await lotsOf(a.id)).map((lot) => lot.remaining), [0, 180], 'soonest lot drained first');
  assert.ok(placed.order.order.id);
  // Time passes: lot A (empty) and a new stale lot C are past their date.
  const c = await lots().create({
    data: { customerId: a.id, source: 'adjust', points: 50, remaining: 50, expiresAt: new Date(Date.now() - DAY) },
  });
  await app.db.connection.transaction((trx) =>
    loyalty.post(trx, { customerId: a.id, kind: 'adjust', points: 50, lotId: c.id, actorRef: 'test', at: new Date(Date.now() - 2 * DAY) }),
  );
  await lots().update({ where: { id: lotA.id }, data: { expiresAt: new Date(Date.now() - DAY) } });
  assert.equal(await balanceOf(a.id), 230);
  const first = await run();
  assert.equal(first.ran, true);
  assert.deepEqual([first.expired, first.points], [1, 50], 'only the stale lot with points left expires');
  const expireRows = await ledger().findMany({ where: { customerId: a.id, kind: 'expire' } });
  assert.deepEqual(expireRows.map((row) => [row.lotId, row.points]), [[c.id, -50]]);
  assert.equal(await balanceOf(a.id), 180);
  assert.deepEqual((await lotsOf(a.id)).map((lot) => lot.remaining), [0, 180, 0]);
  const again = await run();
  assert.deepEqual([again.expired, again.points], [0, 0], 'a rerun writes off nothing');
  assert.equal((await ledger().findMany({ where: { customerId: a.id, kind: 'expire' } })).length, 1);
  await assertLedger(a.id, 'A');
  assert.equal(lotB.remaining, 200);
  console.log('[ordering-test] expiry: oldest lot spent first, only the stale remainder expires, rerun is a no-op');

  // ── B. Expiry vs redeem: an expired lot cannot be spent even before the job runs ───────────
  const b = await newCustomer([[100, -1], [60, 30]]);
  const quote = await order.quote(
    { ...basicOrderInput({ adjustments: [], contact: { name: 'K', phone: b.phone }, customerId: b.id }), redeemPoints: 100 },
    systemCtx,
  );
  assert.equal(quote.loyalty.reason, 'insufficient', 'the 100-point lot is past its date');
  assert.equal(quote.loyalty.redeemable.max, 60);
  await run();
  assert.equal(await balanceOf(b.id), 60);
  await assertLedger(b.id, 'B');

  // ── C. Reminder: one mail per lot, consented customers with an email only ──────────────────
  const d = await newCustomer([[80, 10], [300, 120]]);
  const noConsent = await newCustomer([[90, 10]], { marketingConsent: { granted: false } });
  const noEmail = await newCustomer([[70, 10]], { email: null });
  const sentBefore = capture.sent.length;
  await run();
  const dMails = mailsTo(d.email);
  assert.equal(dMails.length, 1, 'one reminder for the lot expiring in 10 days');
  assert.match(dMails[0].subject, /80 điểm/);
  assert.match(dMails[0].text, /380/, 'mail carries the balance');
  assert.equal(mailsTo(noConsent.email).length, 0, 'no marketing consent → no mail');
  assert.equal(capture.sent.length, sentBefore + 1);
  const dLots = await lotsOf(d.id);
  assert.ok(dLots[0].reminderSentAt, 'reminded lot is stamped');
  assert.equal(dLots[1].reminderSentAt ?? null, null, 'the 120-day lot is outside the window');
  assert.equal((await lotsOf(noConsent.id))[0].reminderSentAt ?? null, null, 'unconsented lot stays unmarked');
  assert.equal((await lotsOf(noEmail.id))[0].reminderSentAt ?? null, null);
  await run();
  assert.equal(mailsTo(d.email).length, 1, 'rerun sends nothing more');
  // The customer opts in later: the next run mails and stamps.
  await customers().update({ where: { id: noConsent.id }, data: { marketingConsent: { granted: true } } });
  await run();
  assert.equal(mailsTo(noConsent.email).length, 1);
  console.log('[ordering-test] reminder: once per lot, only consented customers with an email, later opt-in is caught');

  // ── D. Program switched off: nothing expires ────────────────────────────────────────────────
  const e = await newCustomer([[40, -2]]);
  await loyaltySettings.put({ ...settingsBody, enabled: false }, systemCtx);
  assert.deepEqual((await run()).expired, 0);
  assert.equal(await balanceOf(e.id), 40);
  await loyaltySettings.put(settingsBody, systemCtx);
  assert.equal((await run()).expired >= 1, true);
  assert.equal(await balanceOf(e.id), 0);

  // ── E. Erase: forfeit what is left, empty the lots, clear the tier ──────────────────────────
  const f = await newCustomer([[120, 30], [60, 90]]);
  await customers().update({ where: { id: f.id }, data: { tierCode: 'thanh-vien', spend12m: 500000 } });
  const lifecycle = plugin.service('loyalty-lifecycle');
  await app.db.transaction(async ({ trx }) => {
    await lifecycle.forfeitInTransaction(trx, f.id, new Date());
  });
  assert.equal(await balanceOf(f.id), 0);
  assert.deepEqual((await lotsOf(f.id)).map((lot) => lot.remaining), [0, 0]);
  const forfeits = await ledger().findMany({ where: { customerId: f.id, kind: 'forfeit' } });
  assert.deepEqual(forfeits.map((row) => row.points).sort((x, y) => x - y), [-120, -60]);
  const cleared = await customers().findOne({ where: { id: f.id } });
  assert.equal(cleared.tierCode, null);
  assert.equal(Number(cleared.spend12m), 0);
  await assertLedger(f.id, 'E');
  // A debt (negative balance) is written off too.
  const g = await newCustomer([]);
  await app.db.connection.transaction((trx) =>
    loyalty.post(trx, { customerId: g.id, kind: 'reverse', points: -15, actorRef: 'test', at: new Date() }),
  );
  await app.db.transaction(async ({ trx }) => lifecycle.forfeitInTransaction(trx, g.id, new Date()));
  assert.equal(await balanceOf(g.id), 0);
  console.log('[ordering-test] erase forfeits lots (−120, −60) and a −15 debt, clears tier and spend');

  // ── F. Access export: balance, lots and ledger, ids and numbers only ─────────────────────────
  const exported = await lifecycle.exportForCustomer(a.id);
  assert.equal(exported.balance, 180);
  assert.equal(exported.lots.length, 3);
  assert.ok(exported.ledger.some((row) => row.kind === 'expire' && row.points === -50));
  assert.ok(exported.ledger.some((row) => row.kind === 'redeem' && row.orderCode === placed.order.order.code));
  const text = JSON.stringify(exported);
  assert.ok(!text.includes(a.phone) && !text.includes('example.invalid'), 'no contact data in the points export');
  const summary = await lifecycle.summaryFor(d.id);
  assert.equal(summary.balance, 380);
  assert.equal(summary.expiringSoon.length, 1);
  assert.equal(summary.expiringSoon[0].points, 80);
  const history = await lifecycle.historyFor(a.id);
  assert.ok(history.items.length >= 4);
  assert.ok(history.items.every((item) => !('actorRef' in item) && !('reason' in item)));
  console.log('[ordering-test] export + summary + history carry numbers only');

  console.log('[ordering-test] loyalty-expiry OK');
});
